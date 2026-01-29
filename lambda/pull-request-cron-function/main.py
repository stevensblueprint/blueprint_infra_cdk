from utils import (
    safe_get_env,
    get_github_token,
    is_pr_open,
    extract_repo_info,
    send_discord_message,
)
import logging
from models import PullRequestReminder
import logging
import boto3
import json

logger = logging.getLogger()
logger.setLevel(logging.INFO)

GITHUB_TOKEN_SECRET_ARN = safe_get_env("GITHUB_TOKEN_SECRET_ARN")

secrets_client = boto3.client("secretsmanager")


def handler(event, context):
    logger.info("Pull Request Cron Function triggered")
    logger.info(f"Event received: {json.dumps(event)}")
    try:
        pr_reminder = PullRequestReminder.from_dict(event)
        logger.info(
            f"Processing reminder for PR: {pr_reminder.pr_title} "
            f"by {pr_reminder.pr_author.github_username}"
        )
    except Exception as e:
        logger.error(f"Failed to parse event data: {e}", exc_info=True)
        return {
            "statusCode": 400,
            "body": json.dumps({"error": "Invalid reminder data"}),
        }

    try:
        gh_token = get_github_token(secrets_client, GITHUB_TOKEN_SECRET_ARN)
        owner, repo, pr_number = extract_repo_info(pr_reminder.pr_html_url)
        logger.info(f"Checking PR #{pr_number} in {owner}/{repo}")
        if not is_pr_open(owner, repo, pr_number, gh_token):
            logger.info(
                f"PR #{pr_number} is closed/merged. Skipping reminder notification."
            )
            return {
                "statusCode": 200,
                "body": json.dumps(
                    {
                        "message": "PR is closed, no reminder sent",
                        "pr_number": pr_number,
                        "pr_url": pr_reminder.pr_html_url,
                    }
                ),
            }
        logger.info(f"PR #{pr_number} is still open. Sending reminder to Discord.")
        send_discord_message(pr_reminder.webhook_url, pr_reminder.discord_msg)
        logger.info(
            f"Successfully sent reminder for PR #{pr_number} to Discord webhook"
        )
        return {
            "statusCode": 200,
            "body": json.dumps(
                {
                    "message": "Reminder sent successfully",
                    "pr_number": pr_number,
                    "pr_url": pr_reminder.pr_html_url,
                    "author": pr_reminder.pr_author.github_username,
                }
            ),
        }
    except Exception as e:
        logger.error(f"Error processing PR reminder: {e}", exc_info=True)
        return {
            "statusCode": 500,
            "body": json.dumps({"error": "Internal server error"}),
        }
