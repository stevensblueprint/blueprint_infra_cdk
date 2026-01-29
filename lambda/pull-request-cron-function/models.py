from dataclasses import dataclass
from typing import Dict, Any


@dataclass
class PullRequestAuthor:
    github_username: str
    discord_username: str


@dataclass
class PullRequestReminder:
    pr_title: str
    pr_html_url: str
    pr_author: PullRequestAuthor
    created_at: str
    discord_msg: Dict[str, Any]
    reviewer: PullRequestAuthor
    days_threshold: int
    webhook_url: str

    @staticmethod
    def from_dict(data: Dict[str, Any]) -> "PullRequestReminder":
        return PullRequestReminder(
            pr_title=data["pr_title"],
            pr_html_url=data["pr_html_url"],
            pr_author=PullRequestAuthor(
                github_username=data["pr_author"]["github_username"],
                discord_username=data["pr_author"]["discord_username"],
            ),
            created_at=data["created_at"],
            discord_msg=data["discord_msg"],
            reviewer=PullRequestAuthor(
                github_username=data["reviewer"]["github_username"],
                discord_username=data["reviewer"]["discord_username"],
            ),
            days_threshold=data["days_threshold"],
            webhook_url=data["webhook_url"],
        )
