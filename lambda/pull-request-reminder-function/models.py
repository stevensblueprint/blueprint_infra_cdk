from dataclasses import dataclass
from typing import List, Dict, Any, Optional


@dataclass
class Repository:
    name: str
    github_secret: str


@dataclass
class TeamConfig:
    name: str
    discord_webhook_url: str
    repositories: List[Repository]
    team_leads: List[str]
    buddies: Dict[str, str]
    username_mappings: Dict[str, str]

    @staticmethod
    def from_dict(data: Dict) -> "TeamConfig":
        return TeamConfig(
            name=data["name"],
            discord_webhook_url=data["discord_webhook_url"],
            repositories=[Repository(**repo) for repo in data["repositories"]],
            team_leads=data["team_leads"],
            buddies=data.get("buddies", {}),
            username_mappings=data.get("username_mappings", {}),
        )


@dataclass
class ReminderConfig:
    reminder_threshold_days: int

    @staticmethod
    def from_dict(data: Dict) -> "ReminderConfig":
        return ReminderConfig(reminder_threshold_days=data["reminder_threshold_days"])


@dataclass
class GitHubUser:
    """Represents a GitHub user from webhook payload."""

    login: str
    id: int
    avatar_url: str
    html_url: str
    type: str

    @staticmethod
    def from_dict(data: Dict[str, Any]) -> "GitHubUser":
        return GitHubUser(
            login=data["login"],
            id=data["id"],
            avatar_url=data["avatar_url"],
            html_url=data["html_url"],
            type=data["type"],
        )


@dataclass
class GitHubRepository:
    """Represents a GitHub repository from webhook payload."""

    name: str
    full_name: str
    html_url: str
    description: Optional[str]
    private: bool

    @staticmethod
    def from_dict(data: Dict[str, Any]) -> "GitHubRepository":
        return GitHubRepository(
            name=data["name"],
            full_name=data["full_name"],
            html_url=data["html_url"],
            description=data.get("description"),
            private=data.get("private", False),
        )


@dataclass
class GitHubPullRequest:
    """Represents a GitHub pull request from webhook payload."""

    title: str
    html_url: str
    number: int
    state: str
    user: GitHubUser
    body: Optional[str]
    created_at: str
    updated_at: str
    draft: bool

    @staticmethod
    def from_dict(data: Dict[str, Any]) -> "GitHubPullRequest":
        return GitHubPullRequest(
            title=data["title"],
            html_url=data["html_url"],
            number=data["number"],
            state=data["state"],
            user=GitHubUser.from_dict(data["user"]),
            body=data.get("body"),
            created_at=data["created_at"],
            updated_at=data["updated_at"],
            draft=data.get("draft", False),
        )


@dataclass
class GitHubWebhookPayload:
    """Represents the complete GitHub webhook payload for PR events."""

    action: str
    pull_request: GitHubPullRequest
    repository: GitHubRepository
    sender: GitHubUser

    @staticmethod
    def from_dict(data: Dict[str, Any]) -> "GitHubWebhookPayload":
        return GitHubWebhookPayload(
            action=data["action"],
            pull_request=GitHubPullRequest.from_dict(data["pull_request"]),
            repository=GitHubRepository.from_dict(data["repository"]),
            sender=GitHubUser.from_dict(data["sender"]),
        )


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

    def to_dict(self) -> Dict[str, Any]:
        return {
            "pr_title": self.pr_title,
            "pr_html_url": self.pr_html_url,
            "pr_author": {
                "github_username": self.pr_author.github_username,
                "discord_username": self.pr_author.discord_username,
            },
            "created_at": self.created_at,
            "discord_msg": self.discord_msg,
            "reviewer": {
                "github_username": self.reviewer.github_username,
                "discord_username": self.reviewer.discord_username,
            },
            "days_threshold": self.days_threshold,
            "webhook_url": self.webhook_url,
        }
