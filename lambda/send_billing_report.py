#!/usr/bin/env python3

import io
import os
import logging
import boto3
import csv
import datetime
from datetime import timedelta
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.mime.application import MIMEApplication

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def lambda_handler(event, context):
    logger.info("Lambda invocation started")

    ce = boto3.client("ce")
    now = datetime.datetime.now()
    first_of_current_month = now.replace(day=1)
    last_month_end = first_of_current_month - timedelta(days=1)
    last_month_start = last_month_end.replace(day=1)

    time_period = {
        "Start": last_month_start.strftime("%Y-%m-%d"),
        "End": (last_month_end + timedelta(days=1)).strftime(
            "%Y-%m-%d"
        ),  # end is exclusive
    }
    logger.info(
        "Querying Cost Explorer for period: %s to %s",
        time_period["Start"],
        time_period["End"],
    )

    try:
        result = ce.get_cost_and_usage(
            TimePeriod=time_period,
            Granularity="DAILY",
            Metrics=["UnblendedCost"],
            GroupBy=[{"Type": "DIMENSION", "Key": "SERVICE"}],
            Filter={
                "Not": {
                    "Dimensions": {
                        "Key": "SERVICE",
                        "Values": ["Savings Plan Negation"],
                    }
                }
            },
        )
    except Exception as e:
        logger.error("Error fetching cost and usage: %s", e, exc_info=True)
        raise

    csv_file = io.StringIO()
    csv_writer = csv.writer(csv_file)
    csv_writer.writerow(["Service", "Cost"])

    groups = result.get("ResultsByTime", [])
    if not groups:
        logger.warning("No cost data returned for the period.")
    else:
        for group in groups[0].get("Groups", []):
            service_name = group["Keys"][0]
            cost_amount = group["Metrics"]["UnblendedCost"]["Amount"]
            csv_writer.writerow([service_name, cost_amount])
            logger.debug("Added row to CSV: %s, %s", service_name, cost_amount)

    csv_file.seek(0)
    sender = os.environ.get("SENDER_EMAIL")
    recipients_env = os.environ.get("RECIPIENT_EMAILS")
    if not sender:
        logger.error("SENDER_EMAIL environment variable is not set.")
        raise ValueError("SENDER_EMAIL environment variable is required")
    if not recipients_env:
        logger.error("RECIPIENT_EMAILS environment variable is not set.")
        raise ValueError("RECIPIENT_EMAILS environment variable is required")

    recipients = [email.strip() for email in recipients_env.split(",") if email.strip()]
    if not recipients:
        logger.error("No valid recipient email addresses found in RECIPIENT_EMAILS.")
        raise ValueError("At least one valid recipient email is required")

    logger.info("Sending billing report to: %s", recipients)

    subject = f"AWS Cost Explorer Report for {last_month_start.strftime('%Y-%m')}"
    body = "Please find attached the AWS billing data for last month."

    msg = MIMEMultipart()
    msg["From"] = sender
    msg["To"] = ", ".join(recipients)
    msg["Subject"] = subject
    msg.attach(MIMEText(body))

    csv_part = MIMEApplication(csv_file.read(), _subtype="csv")
    csv_part.add_header(
        "Content-Disposition",
        "attachment",
        filename=f'aws-cost-report-{last_month_start.strftime("%Y-%m")}.csv',
    )
    msg.attach(csv_part)

    ses = boto3.client("ses")
    try:
        response = ses.send_raw_email(
            RawMessage={"Data": msg.as_bytes()},
            Destinations=recipients,
            Source=sender,
        )
        logger.info("Email sent successfully: %s", response["MessageId"])
    except Exception as e:
        logger.error("Error sending email: %s", e, exc_info=True)
        raise

    logger.info("Lambda invocation completed")
