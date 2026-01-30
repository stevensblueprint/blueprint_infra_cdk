import json
import urllib.request
import logging
from typing import Dict, Any
from utils import (
    verify_signature,
    get_days_threshold_and_team_configs,
    safe_get_env,
    get_author_and_reviewer_discord_mentions,
    get_pr_open_discord_msg,
    get_reminder_discord_msg,
)
from models import (
    TeamConfig,
    Repository,
    GitHubWebhookPayload,
    PullRequestReminder,
    PullRequestAuthor,
)
import boto3
from datetime import datetime, timedelta

logger = logging.getLogger()
logger.setLevel(logging.INFO)

FRIENDLY_MESSAGES_PR_OPENED = [
    "Hello {reviewer_discord}! Your coding buddy {publisher_discord} just opened a pull request in `{repo}`. Would you give it a look?",
    "Hey {reviewer_discord} — {publisher_discord} submitted a PR for `{repo}`. Mind reviewing when you have a moment?",
    "Hi {reviewer_discord}! A new PR from {publisher_discord} is ready in `{repo}`. Please take a peek.",
    "Howdy {reviewer_discord}! {publisher_discord} just shipped a PR to `{repo}`. Could you review it?",
]
FRIENDLY_MESSAGES_PR_REMINDER = [
    "Hey {publisher_discord}, just a friendly reminder that your PR in `{repo}` has been open for {days_open} days. Could you please take a look or update it?",
    "Hi {publisher_discord}! Your PR in `{repo}` has been open for {days_open} days — just checking in to see if it needs a final push or update",
    "Quick ping {publisher_discord}! The PR you opened in `{repo}` has been waiting for {days_open} days. Let us know if it's ready or needs help.",
    "Hey {publisher_discord} 👋 Just a heads up that your PR in `{repo}` has been open for {days_open} days. Feel free to update, close, or ask for a review!",
    "Hello {publisher_discord}! Noticed your PR in `{repo}` has been open for {days_open} days. Let us know if there's anything blocking it.",
]

SCHEDULER_GROUP_NAME = safe_get_env("SCHEDULER_GROUP_NAME")
REMINDER_FUNCTION_ARN = safe_get_env("REMINDER_FUNCTION_ARN")
SCHEDULER_INVOKE_ROLE_ARN = safe_get_env("SCHEDULER_INVOKE_ROLE_ARN")

scheduler_client = boto3.client("scheduler")


def handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    logger.info("Received event")
    try:
        threshold_days, team_configs = get_days_threshold_and_team_configs()
        logger.info(f"Loaded {len(team_configs)} team configurations")
    except Exception as e:
        logger.error(f"Failed to load team configurations: {e}", exc_info=True)
        return {"statusCode": 500, "body": "Configuration Error"}

    try:
        payload_dict = json.loads(event["body"])
        payload = GitHubWebhookPayload.from_dict(payload_dict)
    except json.JSONDecodeError as e:
        logger.error(f"Failed to parse event body: {e}")
        return {"statusCode": 400, "body": "Invalid JSON body"}

    if payload.action != "opened":
        logger.info(f"Ignoring action: {payload.action}")
        return {"statusCode": 200, "body": "Ignored action"}

    pr = payload.pull_request
    repo = payload.repository
    logger.info(f"Processing PR opened in repository: {repo.name}")

    team_config: TeamConfig | None = None
    repo_config: Repository | None = None

    for tc in team_configs:
        for r in tc.repositories:
            if r.name == repo.name:
                team_config = tc
                repo_config = r
                break
        if team_config:
            break

    if not team_config or not repo_config:
        logger.warning(f"No team config found for repository: {repo.name}")
        return {"statusCode": 404, "body": "No team config for this repository"}

    logger.info(f"Matched team: {team_config.name}")

    if not verify_signature(event, repo_config.github_secret):
        logger.error("Signature verification failed")
        return {"statusCode": 403, "body": json.dumps("Forbidden: Invalid Signature")}

    publisher_gh = pr.user.login
    logger.info(f"PR Author: {publisher_gh}")

    reviewer_gh = team_config.buddies.get(publisher_gh)
    if not publisher_gh or not reviewer_gh:
        logger.error(f"No buddy assigned for user: {publisher_gh}")
        return {"statusCode": 400, "body": "No buddy assigned"}

    logger.info(f"Assigned reviewer: {reviewer_gh}")
    author_discord_id, reviewer_discord_id = get_author_and_reviewer_discord_mentions(
        team_config, publisher_gh, reviewer_gh
    )

    req = urllib.request.Request(
        team_config.discord_webhook_url,
        data=json.dumps(
            get_pr_open_discord_msg(
                FRIENDLY_MESSAGES_PR_OPENED,
                reviewer_discord_id,
                author_discord_id,
                repo,
                pr,
            )
        ).encode("utf-8"),
        headers={"User-Agent": "AWS-Lambda", "Content-Type": "application/json"},
    )

    try:
        urllib.request.urlopen(req)
        logger.info(f"Successfully sent notification to Discord for {repo.name}")
    except Exception as e:
        logger.error(f"Error sending webhook to Discord: {e}", exc_info=True)
        return {"statusCode": 500, "body": "Error sending webhook"}

    pr_reminder_input = PullRequestReminder(
        pr_title=pr.title,
        pr_html_url=pr.html_url,
        pr_author=PullRequestAuthor(
            github_username=publisher_gh,
            discord_username=author_discord_id,
        ),
        created_at=pr.created_at,
        discord_msg=get_reminder_discord_msg(
            FRIENDLY_MESSAGES_PR_REMINDER, author_discord_id, repo, threshold_days, pr
        ),
        reviewer=PullRequestAuthor(
            github_username=reviewer_gh,
            discord_username=reviewer_discord_id,
        ),
        days_threshold=threshold_days,
        webhook_url=team_config.discord_webhook_url,
    )

    try:
        schedule_name = f"pr-reminder-{repo.name}-{pr.number}"
        schedule_time = datetime.utcnow() + timedelta(days=threshold_days)
        schedule_expression = f"at({schedule_time.strftime('%Y-%m-%dT%H:%M:%S')})"
        logger.info(
            f"Creating schedule '{schedule_name}' to trigger at {schedule_time.isoformat()}"
        )
        scheduler_client.create_schedule(
            Name=schedule_name,
            GroupName=SCHEDULER_GROUP_NAME,
            ScheduleExpression=schedule_expression,
            ScheduleExpressionTimezone="UTC",
            FlexibleTimeWindow={"Mode": "OFF"},
            Target={
                "Arn": REMINDER_FUNCTION_ARN,
                "RoleArn": SCHEDULER_INVOKE_ROLE_ARN,
                "Input": json.dumps(pr_reminder_input.to_dict()),
                "RetryPolicy": {
                    "MaximumRetryAttempts": 2,
                    "MaximumEventAgeInSeconds": 3600,
                },
            },
            State="ENABLED",
            Description=f"Reminder for PR #{pr.number} in {repo.name}",
        )
        logger.info(
            f"Successfully scheduled reminder for PR #{pr.number} in {repo.name} "
            f"to trigger in {threshold_days} days"
        )
    except scheduler_client.exceptions.ConflictException:
        logger.warning(f"Schedule '{schedule_name}' already exists, updating it")
        try:
            scheduler_client.update_schedule(
                Name=schedule_name,
                GroupName=SCHEDULER_GROUP_NAME,
                ScheduleExpression=schedule_expression,
                ScheduleExpressionTimezone="UTC",
                FlexibleTimeWindow={"Mode": "OFF"},
                Target={
                    "Arn": REMINDER_FUNCTION_ARN,
                    "RoleArn": SCHEDULER_INVOKE_ROLE_ARN,
                    "Input": json.dumps(pr_reminder_input.to_dict()),
                    "RetryPolicy": {
                        "MaximumRetryAttempts": 2,
                        "MaximumEventAgeInSeconds": 3600,
                    },
                },
                State="ENABLED",
            )
            logger.info(f"Successfully updated schedule '{schedule_name}'")
        except Exception as update_error:
            logger.error(
                f"Failed to update schedule '{schedule_name}': {update_error}",
                exc_info=True,
            )
            return {"statusCode": 500, "body": "Error updating schedule"}
    except Exception as e:
        logger.error(f"Error creating schedule: {e}", exc_info=True)
        return {"statusCode": 500, "body": "Error creating schedule"}
    return {"statusCode": 200, "body": json.dumps("Notification Sent")}
