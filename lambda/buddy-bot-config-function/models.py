from dataclasses import dataclass, field
from typing import Dict, List, Optional


@dataclass
class Repository:
    name: str
    github_secret: str

    @staticmethod
    def from_dict(data: Dict) -> "Repository":
        return Repository(
            name=data["name"],
            github_secret=data.get("github_secret", ""),
        )

    def to_dict(self) -> Dict:
        return {"name": self.name, "github_secret": self.github_secret}


@dataclass
class Settings:
    reminder_threshold_days: int = 1

    @staticmethod
    def from_dict(data: Dict) -> "Settings":
        return Settings(
            reminder_threshold_days=int(data.get("reminder_threshold_days", 1)),
        )

    def to_dict(self) -> Dict:
        return {"reminder_threshold_days": self.reminder_threshold_days}


@dataclass
class TeamConfig:
    name: str
    discord_webhook_url: str
    repositories: List[Repository] = field(default_factory=list)
    team_leads: List[str] = field(default_factory=list)
    buddies: Dict[str, str] = field(default_factory=dict)
    username_mappings: Dict[str, str] = field(default_factory=dict)

    @staticmethod
    def from_dict(data: Dict) -> "TeamConfig":
        return TeamConfig(
            name=data["name"],
            discord_webhook_url=data.get("discord_webhook_url", ""),
            repositories=[Repository.from_dict(r) for r in data.get("repositories", [])],
            team_leads=data.get("team_leads", []),
            buddies=data.get("buddies", {}),
            username_mappings=data.get("username_mappings", {}),
        )

    def to_dict(self) -> Dict:
        return {
            "name": self.name,
            "discord_webhook_url": self.discord_webhook_url,
            "repositories": [r.to_dict() for r in self.repositories],
            "team_leads": self.team_leads,
            "buddies": self.buddies,
            "username_mappings": self.username_mappings,
        }


@dataclass
class BuddyBotConfig:
    teams: List[TeamConfig] = field(default_factory=list)
    settings: Optional[Settings] = None

    @staticmethod
    def from_dict(data: Dict) -> "BuddyBotConfig":
        settings_data = data.get("settings")
        return BuddyBotConfig(
            teams=[TeamConfig.from_dict(t) for t in data.get("teams", [])],
            settings=Settings.from_dict(settings_data) if settings_data is not None else None,
        )

    def to_dict(self) -> Dict:
        result: Dict = {"teams": [t.to_dict() for t in self.teams]}
        if self.settings is not None:
            result["settings"] = self.settings.to_dict()
        return result

    def find_team(self, name: str) -> Optional[TeamConfig]:
        for team in self.teams:
            if team.name == name:
                return team
        return None
