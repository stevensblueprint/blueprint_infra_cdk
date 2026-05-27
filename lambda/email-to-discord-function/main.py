import email
import html
import json
import logging
import os
import re
import urllib.request

import boto3

logger = logging.getLogger()
logger.setLevel(logging.INFO)

EMAIL_DISCORD_MAPPINGS: dict[str, dict] = json.loads(os.environ["EMAIL_DISCORD_MAPPINGS"])
EMAIL_BUCKET = os.environ["EMAIL_BUCKET"]
FORWARD_SENDER = os.environ.get("FORWARD_SENDER", "no-reply@example.com")

s3_client = boto3.client("s3")
ses_client = boto3.client("ses")


def strip_html(html_content: str) -> str:
    text = re.sub(r"<[^>]+>", " ", html_content)
    text = html.unescape(text)
    return re.sub(r"\s+", " ", text).strip()


def extract_body(msg) -> str:
    if msg.is_multipart():
        for part in msg.walk():
            if part.get_content_type() == "text/plain":
                payload = part.get_payload(decode=True)
                if payload:
                    return payload.decode("utf-8", errors="replace")
        for part in msg.walk():
            if part.get_content_type() == "text/html":
                payload = part.get_payload(decode=True)
                if payload:
                    return strip_html(payload.decode("utf-8", errors="replace"))
    else:
        payload = msg.get_payload(decode=True)
        if payload:
            body = payload.decode("utf-8", errors="replace")
            return strip_html(body) if msg.get_content_type() == "text/html" else body
    return "(no body)"


def resolve_mapping(recipients: list[str]) -> dict | None:
    for recipient in recipients:
        local = recipient.split("@")[0].lower()
        if local in EMAIL_DISCORD_MAPPINGS:
            return EMAIL_DISCORD_MAPPINGS[local]
    return None


def post_to_discord(from_addr: str, subject: str, body: str, webhook_url: str) -> None:
    MAX_BODY = 3900
    truncated = body[:MAX_BODY] + "\n*(truncated)*" if len(body) > MAX_BODY else body

    payload = {
        "embeds": [
            {
                "title": subject[:256],
                "description": f"**From:** {from_addr}\n\n{truncated}",
                "color": 0x5865F2,
            }
        ]
    }

    req = urllib.request.Request(
        webhook_url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"User-Agent": "AWS-Lambda", "Content-Type": "application/json"},
        method="POST",
    )
    urllib.request.urlopen(req)
    logger.info(f"Sent email to Discord: {subject}")


def forward_email(from_addr: str, subject: str, body: str, forward_emails: list[str]) -> None:
    fwd_body = f"---------- Forwarded message ----------\nFrom: {from_addr}\nSubject: {subject}\n\n{body}"
    
    for recipient in forward_emails:
        try:
            ses_client.send_email(
                Source=FORWARD_SENDER,
                Destination={"ToAddresses": [recipient]},
                Message={
                    "Subject": {"Data": f"Fwd: {subject}"},
                    "Body": {
                        "Text": {"Data": fwd_body}
                    },
                },
                ReplyToAddresses=[from_addr]
            )
            logger.info(f"Forwarded email to {recipient}")
        except Exception as e:
            logger.error(f"Failed to forward email to {recipient}: {e}", exc_info=True)


def handler(event, _context):
    for record in event["Records"]:
        ses_mail = record["ses"]["mail"]
        message_id = ses_mail["messageId"]
        common_headers = ses_mail.get("commonHeaders", {})
        subject = common_headers.get("subject", "No Subject")
        from_list = common_headers.get("from", ["Unknown"])
        from_addr = from_list[0] if from_list else "Unknown"
        recipients = record["ses"]["receipt"].get("recipients", [])

        mapping = resolve_mapping(recipients)
        if not mapping:
            logger.warning(f"No Discord mapping for recipients {recipients}, skipping")
            continue

        sender_domain = from_addr.split("@")[-1].rstrip(">").lower()
        allowed = [d.lower() for d in mapping.get("allowedSenderDomains", [])]
        if allowed and sender_domain not in allowed:
            logger.warning(f"Rejected email from {from_addr}: domain not in allowed list")
            continue

        webhook_url = mapping["webhookUrl"]
        forward_emails = mapping.get("forwardEmails", [])

        logger.info(f"Processing email {message_id}: {subject}")

        try:
            response = s3_client.get_object(Bucket=EMAIL_BUCKET, Key=f"emails/{message_id}")
            raw_email = response["Body"].read()
        except Exception as e:
            logger.error(f"Failed to read email from S3: {e}", exc_info=True)
            continue

        msg = email.message_from_bytes(raw_email)
        body = extract_body(msg)

        # Post to Discord
        try:
            post_to_discord(from_addr, subject, body, webhook_url)
        except Exception as e:
            logger.error(f"Failed to post to Discord: {e}", exc_info=True)

        # Forward to registered emails
        if forward_emails:
            forward_email(from_addr, subject, body, forward_emails)

    return {"disposition": "CONTINUE"}
