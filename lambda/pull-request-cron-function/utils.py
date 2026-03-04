import os
import logging
import json
import urllib.request
from urllib.error import HTTPError
from typing import Dict, Any

logger = logging.getLogger()
logger.setLevel(logging.INFO)


def safe_get_env(var_name: str) -> str:
    value = os.environ.get(var_name)
    if value is None:
        logger.error(f"Environment variable {var_name} not set")
        raise EnvironmentError(f"Environment variable {var_name} not set")
    return value


def get_github_token(secrets_client, secret_arn: str) -> str:
    """Retrieve GitHub token from AWS Secrets Manager"""
    try:
        response = secrets_client.get_secret_value(SecretId=secret_arn)
        return response["SecretString"]
    except Exception as e:
        logger.error(f"Failed to retrieve GitHub token: {e}", exc_info=True)
        raise


def is_pr_open(owner: str, repo: str, pr_number: int, gh_token: str) -> bool:
    """
    Check if a pull request is still open using GitHub API

    Args:
        owner: Repository owner
        repo: Repository name
        pr_number: Pull request number
        github_token: GitHub personal access token

    Returns:
        True if PR is open, False if closed/merged
    """
    api_url = f"https://api.github.com/repos/{owner}/{repo}/pulls/{pr_number}"

    headers = {
        "Authorization": f"Bearer {gh_token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "AWS-Lambda-PR-Reminder",
    }

    try:
        req = urllib.request.Request(api_url, headers=headers)
        with urllib.request.urlopen(req) as response:
            data = json.loads(response.read().decode("utf-8"))
            pr_state = data.get("state", "").lower()
            logger.info(f"PR #{pr_number} state: {pr_state}")
            return pr_state == "open"
    except HTTPError as e:
        logger.error(
            f"HTTP error checking PR status: {e.code} - {e.reason}", exc_info=True
        )
        if e.code == 404:
            logger.warning(f"PR #{pr_number} not found, treating as closed")
            return False
        raise
    except Exception as e:
        logger.error(f"Error checking PR status: {e}", exc_info=True)
        raise


def extract_repo_info(pr_html_url: str) -> tuple[str, str, int]:
    """
    Extract owner, repo name, and PR number from GitHub PR URL

    Args:
        pr_html_url: GitHub PR URL (e.g., https://github.com/owner/repo/pull/123)

    Returns:
        Tuple of (owner, repo, pr_number)
    """
    # URL format: https://github.com/owner/repo/pull/123
    parts = pr_html_url.rstrip("/").split("/")
    pr_number = int(parts[-1])
    repo = parts[-3]
    owner = parts[-4]
    return owner, repo, pr_number


def send_discord_message(webhook_url: str, message: Dict[str, Any]) -> None:
    """
    Send a message to Discord webhook

    Args:
        webhook_url: Discord webhook URL
        message: Message payload to send
    """
    req = urllib.request.Request(
        webhook_url,
        data=json.dumps(message).encode("utf-8"),
        headers={"User-Agent": "AWS-Lambda", "Content-Type": "application/json"},
    )

    try:
        with urllib.request.urlopen(req) as response:
            logger.info(f"Discord message sent successfully: {response.status}")
    except HTTPError as e:
        error_body = e.read().decode("utf-8")
        logger.error(
            f"HTTP error sending Discord message: {e.code} - {e.reason} - {error_body}",
            exc_info=True,
        )
        raise
    except Exception as e:
        logger.error(f"Error sending Discord message: {e}", exc_info=True)
        raise
