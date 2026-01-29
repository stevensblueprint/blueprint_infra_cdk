import logging
import os
import boto3
import json
from models import TeamConfig
from typing import Dict, Any, List, Tuple
import hmac
import hashlib
import re
import random
from models import GitHubPullRequest, GitHubRepository

logger = logging.getLogger()
logger.setLevel(logging.INFO)

secrets_client = boto3.client("secretsmanager")
TEAM_CONFIG_SECRET_ARN = "TEAM_CONFIG_SECRET_ARN"
REMINDER_THRESHOLD_DAYS_DEFAULT = 5


def safe_get_env(var_name: str) -> str:
    value = os.environ.get(var_name)
    if value is None:
        logger.error(f"Environment variable {var_name} not set")
        raise EnvironmentError(f"Environment variable {var_name} not set")
    return value


def get_days_threshold_and_team_configs() -> Tuple[int, List[TeamConfig]]:
    """Fetch and parse the configuration from AWS Secrets Manager"""
    secret_arn = safe_get_env(TEAM_CONFIG_SECRET_ARN)
    if not secret_arn:
        logger.error("TEAM_CONFIG_SECRET_ARN environment variable not set")
        raise ValueError("TEAM_CONFIG_SECRET_ARN environment variable not set")

    try:
        logger.info(f"Fetching secret value from ARN: {secret_arn}")
        response = secrets_client.get_secret_value(SecretId=secret_arn)
        secret_string = response.get("SecretString")
        config_data = json.loads(secret_string)
        logger.info("Successfully loaded team configurations from secrets manager")
        reminder_threshold_days = (
            config_data.get("reminder_threshold_days")
            or REMINDER_THRESHOLD_DAYS_DEFAULT
        )
        return reminder_threshold_days, [
            TeamConfig.from_dict(tc) for tc in config_data["teams"]
        ]
    except Exception as e:
        logger.error(f"Failed to load secrets: {str(e)}", exc_info=True)
        raise e


def verify_signature(event: Dict[str, Any], github_secrets: str) -> bool:
    """Verify that the request actually came from GitHub"""
    signature = event["headers"].get("x-hub-signature-256")
    body = event["body"].encode("utf-8")
    if signature is None:
        return False
    key = github_secrets.encode("utf-8")
    expected = "sha256=" + hmac.new(key, body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(signature, expected)


def format_discord_mention(value: str) -> str:
    """
    Accepts:
      - raw numeric user id: "123..."
      - already formatted mention: "<@123...>" / "<@!123...>"
      - (fallback) a username: "damnielll" -> "@damnielll" (won't ping from webhooks)
    """
    if not value:
        return value

    v = value.strip()
    if re.fullmatch(r"<@!?\d+>", v):
        return v
    if v.isdigit():
        return f"<@{v}>"
    if not v.startswith("@"):
        v = "@" + v
    return v


def get_author_and_reviewer_discord_mentions(
    team_config: TeamConfig,
    publisher_gh: str,
    reviewer_gh: str,
) -> Tuple[str, str]:
    author_discord = team_config.username_mappings.get(publisher_gh) or publisher_gh
    reviewer_discord = team_config.username_mappings.get(reviewer_gh) or reviewer_gh
    return format_discord_mention(author_discord), format_discord_mention(
        reviewer_discord
    )


def get_pr_open_discord_msg(
    friendly_messages: List[str],
    reviewer_discord: str,
    publisher_discord: str,
    repo: GitHubRepository,
    pr: GitHubPullRequest,
) -> Dict[str, Any]:
    return {
        "content": random.choice(friendly_messages).format(
            reviewer_discord=reviewer_discord,
            publisher_discord=publisher_discord,
            repo=repo.full_name,
        ),
        "allowed_mentions": {"parse": ["users"]},
        "embeds": [
            {
                "title": pr.title,
                "url": pr.html_url,
                "color": 5814783,
                "fields": [
                    {"name": "Author", "value": publisher_discord, "inline": True},
                    {
                        "name": "Reviewers Needed",
                        "value": reviewer_discord,
                        "inline": True,
                    },
                ],
            }
        ],
    }


def get_reminder_discord_msg(
    friendly_messages: List[str],
    publisher_discord: str,
    repo: GitHubRepository,
    threshold_days: int,
    pr: GitHubPullRequest,
) -> Dict[str, Any]:
    return {
        "content": random.choice(friendly_messages).format(
            publisher_discord=publisher_discord,
            repo=repo.full_name,
            days_open=threshold_days,
        ),
        "allowed_mentions": {"parse": ["users"]},
        "embeds": [
            {
                "title": pr.title,
                "url": pr.html_url,
                "color": 16753920,
                "fields": [
                    {"name": "Author", "value": publisher_discord, "inline": True},
                    {
                        "name": "Days Open",
                        "value": str(threshold_days),
                        "inline": True,
                    },
                ],
            }
        ],
    }
