import json
import urllib.request
import random
import logging
from typing import Dict, Any
from utils import verify_signature, format_discord_mention, get_team_configs

logger = logging.getLogger()
logger.setLevel(logging.INFO)

FRIENDLY_MESSAGES = [
    "Hello {reviewer_discord}! Your coding buddy {publisher_discord} just opened a pull request in `{repo}`. Would you give it a look?",
    "Hey {reviewer_discord} — {publisher_discord} submitted a PR for `{repo}`. Mind reviewing when you have a moment?",
    "Hi {reviewer_discord}! A new PR from {publisher_discord} is ready in `{repo}`. Please take a peek.",
    "Howdy {reviewer_discord}! {publisher_discord} just shipped a PR to `{repo}`. Could you review it?",
]


def handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    logger.info("Received event")
    try:
        team_configs = get_team_configs()
        logger.info(f"Loaded {len(team_configs)} team configurations")
    except Exception as e:
        logger.error(f"Failed to load team configurations: {e}", exc_info=True)
        return {"statusCode": 500, "body": "Configuration Error"}

    try:
        payload = json.loads(event["body"])
    except json.JSONDecodeError as e:
        logger.error(f"Failed to parse event body: {e}")
        return {"statusCode": 400, "body": "Invalid JSON body"}

    action = payload.get("action")
    if action != "opened":
        logger.info(f"Ignoring action: {action}")
        return {"statusCode": 200, "body": "Ignored action"}

    pr = payload["pull_request"]
    repo = payload["repository"]
    repo_name = repo["name"]
    logger.info(f"Processing PR opened in repository: {repo_name}")

    matches = [
        (tc, r) for tc in team_configs for r in tc.repositories if r.name == repo_name
    ]
    if not matches:
        logger.warning(f"No team config found for repository: {repo_name}")
        return {"statusCode": 404, "body": "No team config for this repository"}
    team_config, repo_config = matches[0]
    logger.info(f"Matched team: {team_config.name}")

    if not verify_signature(event, repo_config.github_secret):
        logger.error("Signature verification failed")
        return {"statusCode": 403, "body": json.dumps("Forbidden: Invalid Signature")}

    publisher_gh = pr["user"]["login"]
    logger.info(f"PR Author: {publisher_gh}")

    reviewer_gh = team_config.buddies.get(publisher_gh)
    if not publisher_gh or not reviewer_gh:
        logger.error(f"No buddy assigned for user: {publisher_gh}")
        return {"statusCode": 400, "body": "No buddy assigned"}

    logger.info(f"Assigned reviewer: {reviewer_gh}")

    publisher_discord = team_config.username_mappings.get(publisher_gh) or publisher_gh
    reviewer_discord = team_config.username_mappings.get(reviewer_gh) or reviewer_gh
    publisher_mention = format_discord_mention(publisher_discord)
    reviewer_mention = format_discord_mention(reviewer_discord)

    discord_msg = {
        "content": random.choice(FRIENDLY_MESSAGES).format(
            reviewer_discord=reviewer_mention,
            publisher_discord=publisher_mention,
            repo=repo["full_name"],
        ),
        "allowed_mentions": {"parse": ["users"]},
        "embeds": [
            {
                "title": pr["title"],
                "url": pr["html_url"],
                "color": 5814783,
                "fields": [
                    {"name": "Author", "value": publisher_mention, "inline": True},
                    {
                        "name": "Reviewers Needed",
                        "value": reviewer_mention,
                        "inline": True,
                    },
                ],
            }
        ],
    }
    req = urllib.request.Request(
        team_config.discord_webhook_url,
        data=json.dumps(discord_msg).encode("utf-8"),
        headers={"User-Agent": "AWS-Lambda", "Content-Type": "application/json"},
    )

    try:
        urllib.request.urlopen(req)
        logger.info(f"Successfully sent notification to Discord for {repo_name}")
    except Exception as e:
        logger.error(f"Error sending webhook to Discord: {e}", exc_info=True)
        return {"statusCode": 500, "body": "Error sending webhook"}

    return {"statusCode": 200, "body": json.dumps("Notification Sent")}
