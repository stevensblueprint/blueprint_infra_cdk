import boto3
import json
import os
from typing import Any, Dict

from models import BuddyBotConfig, Repository, Settings, TeamConfig

sm = boto3.client("secretsmanager")
SECRET_ARN = os.environ["TEAM_CONFIG_SECRET_ARN"]


def _read_config() -> BuddyBotConfig:
    raw = sm.get_secret_value(SecretId=SECRET_ARN)["SecretString"]
    return BuddyBotConfig.from_dict(json.loads(raw))


def _write_config(config: BuddyBotConfig) -> None:
    sm.put_secret_value(SecretId=SECRET_ARN, SecretString=json.dumps(config.to_dict()))


CORS_HEADERS = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Authorization,Content-Type,X-Amz-Date,X-Api-Key,X-Amz-Security-Token",
}


def _ok(body: Any, status: int = 200) -> Dict:
    return {
        "statusCode": status,
        "headers": CORS_HEADERS,
        "body": json.dumps(body),
    }


def _err(message: str, status: int = 400) -> Dict:
    return {
        "statusCode": status,
        "headers": CORS_HEADERS,
        "body": json.dumps({"error": message}),
    }


def handler(event: Dict, context: Any) -> Dict:
    method: str = event.get("httpMethod", "")
    path: str = event.get("path", "")
    params: Dict = event.get("pathParameters") or {}
    raw_body: str = event.get("body") or "{}"

    try:
        body: Dict = json.loads(raw_body)
    except json.JSONDecodeError:
        return _err("Invalid JSON body")

    try:
        # --- /config ---
        if path == "/config":
            if method == "GET":
                return _ok(_read_config().to_dict())
            if method == "PUT":
                if not isinstance(body, dict) or "teams" not in body:
                    return _err("Body must be an object with a 'teams' key")
                config = BuddyBotConfig.from_dict(body)
                _write_config(config)
                return _ok(config.to_dict())

        # --- /config/settings ---
        if path == "/config/settings":
            config = _read_config()
            if method == "GET":
                settings = config.settings or Settings()
                return _ok({"settings": settings.to_dict()})
            if method == "PUT":
                config.settings = Settings.from_dict(body)
                _write_config(config)
                return _ok({"settings": config.settings.to_dict()})

        # --- /config/teams ---
        if path == "/config/teams":
            config = _read_config()
            if method == "GET":
                return _ok({"teams": [t.to_dict() for t in config.teams]})
            if method == "POST":
                name: str = body.get("name", "")
                if not name:
                    return _err("'name' is required")
                if config.find_team(name):
                    return _err(f"Team '{name}' already exists", 409)
                team = TeamConfig.from_dict(body)
                config.teams.append(team)
                _write_config(config)
                return _ok(team.to_dict(), 201)

        # --- /config/teams/{teamName} ---
        team_name: str = params.get("teamName", "")
        if path == f"/config/teams/{team_name}" and team_name:
            config = _read_config()
            team = config.find_team(team_name)
            if method == "GET":
                if not team:
                    return _err(f"Team '{team_name}' not found", 404)
                return _ok(team.to_dict())
            if method == "PUT":
                if not team:
                    return _err(f"Team '{team_name}' not found", 404)
                body["name"] = team_name
                updated = TeamConfig.from_dict(body)
                config.teams = [updated if t.name == team_name else t for t in config.teams]
                _write_config(config)
                return _ok(updated.to_dict())
            if method == "DELETE":
                if not team:
                    return _err(f"Team '{team_name}' not found", 404)
                config.teams = [t for t in config.teams if t.name != team_name]
                _write_config(config)
                return _ok({"deleted": team_name})

        # --- /config/teams/{teamName}/repositories ---
        if path == f"/config/teams/{team_name}/repositories" and team_name:
            config = _read_config()
            team = config.find_team(team_name)
            if not team:
                return _err(f"Team '{team_name}' not found", 404)
            if method == "GET":
                return _ok({"repositories": [r.to_dict() for r in team.repositories]})
            if method == "POST":
                repo_name: str = body.get("name", "")
                if not repo_name:
                    return _err("'name' is required")
                if any(r.name == repo_name for r in team.repositories):
                    return _err(f"Repository '{repo_name}' already exists in team", 409)
                repo = Repository.from_dict(body)
                team.repositories.append(repo)
                _write_config(config)
                return _ok({"repositories": [r.to_dict() for r in team.repositories]}, 201)

        # --- /config/teams/{teamName}/repositories/{repoName} ---
        repo_name: str = params.get("repoName", "")
        if path == f"/config/teams/{team_name}/repositories/{repo_name}" and team_name and repo_name:
            config = _read_config()
            team = config.find_team(team_name)
            if not team:
                return _err(f"Team '{team_name}' not found", 404)
            if method == "DELETE":
                if not any(r.name == repo_name for r in team.repositories):
                    return _err(f"Repository '{repo_name}' not found in team", 404)
                team.repositories = [r for r in team.repositories if r.name != repo_name]
                _write_config(config)
                return _ok({"deleted": repo_name})

        # --- /config/teams/{teamName}/buddies ---
        if path == f"/config/teams/{team_name}/buddies" and team_name:
            config = _read_config()
            team = config.find_team(team_name)
            if not team:
                return _err(f"Team '{team_name}' not found", 404)
            if method == "PUT":
                buddies = body.get("buddies")
                if not isinstance(buddies, dict):
                    return _err("'buddies' must be an object mapping GitHub usernames")
                team.buddies = buddies
                _write_config(config)
                return _ok({"buddies": team.buddies})

        # --- /config/teams/{teamName}/username-mappings ---
        if path == f"/config/teams/{team_name}/username-mappings" and team_name:
            config = _read_config()
            team = config.find_team(team_name)
            if not team:
                return _err(f"Team '{team_name}' not found", 404)
            if method == "PUT":
                mappings = body.get("username_mappings")
                if not isinstance(mappings, dict):
                    return _err("'username_mappings' must be an object mapping GitHub to Discord usernames")
                team.username_mappings = mappings
                _write_config(config)
                return _ok({"username_mappings": team.username_mappings})

        return _err("Not found", 404)

    except Exception as e:
        return _err(str(e), 500)
