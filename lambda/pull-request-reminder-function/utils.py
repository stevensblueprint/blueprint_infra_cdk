import logging
import os
import boto3
import json
from model import TeamConfig
from typing import Dict, Any
import hmac
import hashlib
import re

logger = logging.getLogger()
logger.setLevel(logging.INFO)

secrets_client = boto3.client("secretsmanager")
TEAM_CONFIG_SECRET_ARN = "TEAM_CONFIG_SECRET_ARN"


def safe_get_env(var_name: str) -> str:
    value = os.environ.get(var_name)
    if value is None:
        logger.error(f"Environment variable {var_name} not set")
        raise ValueError(f"Environment variable {var_name} not set")
    return value


def get_team_configs():
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
        return [TeamConfig.from_dict(tc) for tc in config_data["teams"]]
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
