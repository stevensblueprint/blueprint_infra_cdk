from dataclasses import dataclass
from typing import List, Dict


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
