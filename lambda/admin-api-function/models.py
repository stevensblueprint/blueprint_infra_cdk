from dataclasses import dataclass
from typing import List, Optional, Dict


@dataclass(frozen=True)
class Member:
    _id: str
    first_name: str
    last_name: str
    stevens_email: str
    discord_id: str
    discord_handle: str
    github_username: str
    is_active: bool
    aws_username: Optional[str]


@dataclass(frozen=True)
class Team:
    _id: str
    name: str
    members: List[Member]
    is_active: bool
    coding_buddies_mapping: Optional[Dict[str, str]]


@dataclass(frozen=True)
class GithubRepository:
    name: str
    url: str


@dataclass(frozen=True)
class NpoTeam(Team):
    npo_name: str
