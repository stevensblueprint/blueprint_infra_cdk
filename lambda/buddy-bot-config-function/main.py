import boto3
import json
import logging
import os
from typing import Any, Dict, Optional, Set

from clients import GithubClient
from models import BuddyBotConfig, Repository, Settings, TeamConfig

logger = logging.getLogger()
logger.setLevel(logging.INFO)

sm = boto3.client("secretsmanager")  # type: ignore
SECRET_ARN = os.environ["TEAM_CONFIG_SECRET_ARN"]
GITHUB_TOKEN_SECRET_ARN = os.environ["GITHUB_TOKEN_SECRET_ARN"]
BUDDY_BOT_WEBHOOK_URL = os.environ["BUDDY_BOT_WEBHOOK_URL"]


def _get_github_client() -> GithubClient:
    logger.info("Fetching GitHub token from SecretsManager")
    token = sm.get_secret_value(SecretId=GITHUB_TOKEN_SECRET_ARN)["SecretString"]
    return GithubClient(token, BUDDY_BOT_WEBHOOK_URL)


def _read_config() -> BuddyBotConfig:
    logger.info("Reading BuddyBotConfig from SecretsManager")
    raw = sm.get_secret_value(SecretId=SECRET_ARN)["SecretString"]
    config = BuddyBotConfig.from_dict(json.loads(raw))
    logger.info(f"Config loaded: {len(config.teams)} team(s)")
    return config


def _write_config(config: BuddyBotConfig) -> None:
    logger.info(f"Writing BuddyBotConfig to SecretsManager: {len(config.teams)} team(s)")
    sm.put_secret_value(SecretId=SECRET_ARN, SecretString=json.dumps(config.to_dict()))
    logger.info("Config written successfully")


CORS_HEADERS = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Authorization,Content-Type,X-Amz-Date,X-Api-Key,X-Amz-Security-Token",
}


def _ok(body: Any, status: int = 200) -> Dict:
    return {"statusCode": status, "headers": CORS_HEADERS, "body": json.dumps(body)}


def _err(message: str, status: int = 400) -> Dict:
    return {"statusCode": status, "headers": CORS_HEADERS, "body": json.dumps({"error": message})}


def _repo_prs(client: GithubClient, team: TeamConfig, added: Set[str], removed: Set[str]) -> Dict[str, Any]:
    """Open create/update/delete PRs for repos that changed and return a results map."""
    team_dict = team.to_dict()
    results: Dict[str, Any] = {}
    for repo_name in added:
        try:
            results[repo_name] = {"action": "created", "pr_url": client.create_setup_pr(repo_name, team_dict)}
        except Exception as e:
            logger.warning(f"create_setup_pr failed for {repo_name}: {e}")
            results[repo_name] = {"action": "created", "error": str(e)}
    for repo_name in removed:
        try:
            results[repo_name] = {"action": "deleted", "pr_url": client.delete_setup_files(repo_name, team.name)}
        except Exception as e:
            logger.warning(f"delete_setup_files failed for {repo_name}: {e}")
            results[repo_name] = {"action": "deleted", "error": str(e)}
    for repo_name in {r.name for r in team.repositories} - added:
        try:
            results[repo_name] = {"action": "updated", "pr_url": client.update_setup_files(repo_name, team_dict)}
        except Exception as e:
            logger.warning(f"update_setup_files failed for {repo_name}: {e}")
            results[repo_name] = {"action": "updated", "error": str(e)}
    return results


def handler(event: Dict, context: Any) -> Dict:
    method: str = event.get("httpMethod", "")
    path: str = event.get("path", "")
    params: Dict = event.get("pathParameters") or {}
    raw_body: str = event.get("body") or "{}"

    logger.info(f"Request: {method} {path} params={params}")

    try:
        body: Dict = json.loads(raw_body)
    except json.JSONDecodeError:
        logger.warning(f"Invalid JSON body for {method} {path}")
        return _err("Invalid JSON body")

    try:
        # --- /config ---
        if path == "/config":
            if method == "GET":
                logger.info("GET /config -> returning full config")
                return _ok(_read_config().to_dict())
            if method == "PUT":
                if not isinstance(body, dict) or "teams" not in body:
                    return _err("Body must be an object with a 'teams' key")
                logger.info(f"PUT /config -> replacing config with {len(body.get('teams', []))} team(s)")
                config = BuddyBotConfig.from_dict(body)
                _write_config(config)
                return _ok(config.to_dict())

        # --- /config/settings ---
        if path == "/config/settings":
            config = _read_config()
            if method == "GET":
                logger.info("GET /config/settings -> returning settings")
                return _ok({"settings": (config.settings or Settings()).to_dict()})
            if method == "PUT":
                logger.info(f"PUT /config/settings -> updating settings: {body}")
                config.settings = Settings.from_dict(body)
                _write_config(config)
                return _ok({"settings": config.settings.to_dict()})

        # --- /config/teams ---
        if path == "/config/teams":
            config = _read_config()
            if method == "GET":
                logger.info(f"GET /config/teams -> returning {len(config.teams)} team(s)")
                return _ok({"teams": [t.to_dict() for t in config.teams]})
            if method == "POST":
                name: str = body.get("name", "")
                if not name:
                    return _err("'name' is required")
                if config.find_team(name):
                    logger.warning(f"POST /config/teams -> team '{name}' already exists")
                    return _err(f"Team '{name}' already exists", 409)
                logger.info(f"POST /config/teams -> creating team '{name}'")
                team = TeamConfig.from_dict(body)
                config.teams.append(team)
                _write_config(config)
                logger.info(f"Team '{name}' created successfully")
                github_prs: Dict[str, Any] = {}
                try:
                    client = _get_github_client()
                    added_repos: Set[str] = {r.name for r in team.repositories}
                    github_prs = _repo_prs(client, team, added_repos, set())
                except Exception as e:
                    logger.warning(f"GitHub client error during team POST: {e}")
                return _ok({**team.to_dict(), "github_prs": github_prs}, 201)

        # --- /config/teams/{teamName} ---
        team_name: str = params.get("teamName", "")
        if path == f"/config/teams/{team_name}" and team_name:
            config = _read_config()
            team = config.find_team(team_name)
            if method == "GET":
                if not team:
                    logger.warning(f"GET /config/teams/{team_name} -> not found")
                    return _err(f"Team '{team_name}' not found", 404)
                logger.info(f"GET /config/teams/{team_name} -> returning team")
                return _ok(team.to_dict())
            if method == "PUT":
                if not team:
                    logger.warning(f"PUT /config/teams/{team_name} -> not found")
                    return _err(f"Team '{team_name}' not found", 404)
                old_repo_names: Set[str] = {r.name for r in team.repositories}
                body["name"] = team_name
                updated = TeamConfig.from_dict(body)
                new_repo_names: Set[str] = {r.name for r in updated.repositories}
                added = new_repo_names - old_repo_names
                removed = old_repo_names - new_repo_names
                logger.info(
                    f"PUT /config/teams/{team_name} -> repos added={added} removed={removed} unchanged={new_repo_names - added}"
                )
                config.teams = [updated if t.name == team_name else t for t in config.teams]
                _write_config(config)
                github_prs: Dict[str, Any] = {}
                try:
                    client = _get_github_client()
                    github_prs = _repo_prs(client, updated, added, removed)
                except Exception as e:
                    logger.warning(f"GitHub client error during team PUT: {e}")
                return _ok({**updated.to_dict(), "github_prs": github_prs})
            if method == "DELETE":
                if not team:
                    logger.warning(f"DELETE /config/teams/{team_name} -> not found")
                    return _err(f"Team '{team_name}' not found", 404)
                repo_names = [r.name for r in team.repositories]
                logger.info(f"DELETE /config/teams/{team_name} -> removing team with repos={repo_names}")
                config.teams = [t for t in config.teams if t.name != team_name]
                _write_config(config)
                github_prs = {}
                try:
                    client = _get_github_client()
                    for repo in team.repositories:
                        try:
                            pr_url = client.delete_setup_files(repo.name, team_name)
                            logger.info(f"Opened removal PR for {repo.name}: {pr_url}")
                            github_prs[repo.name] = {"action": "deleted", "pr_url": pr_url}
                        except Exception as e:
                            logger.warning(f"delete_setup_files failed for {repo.name}: {e}")
                            github_prs[repo.name] = {"action": "deleted", "error": str(e)}
                except Exception as e:
                    logger.warning(f"GitHub client error during team DELETE: {e}")
                logger.info(f"Team '{team_name}' deleted; github_prs={list(github_prs.keys())}")
                return _ok({"deleted": team_name, "github_prs": github_prs})

        # --- /config/teams/{teamName}/repositories ---
        if path == f"/config/teams/{team_name}/repositories" and team_name:
            config = _read_config()
            team = config.find_team(team_name)
            if not team:
                logger.warning(f"{method} /config/teams/{team_name}/repositories -> team not found")
                return _err(f"Team '{team_name}' not found", 404)
            if method == "GET":
                logger.info(f"GET /config/teams/{team_name}/repositories -> {len(team.repositories)} repo(s)")
                return _ok({"repositories": [r.to_dict() for r in team.repositories]})
            if method == "POST":
                repo_name: str = body.get("name", "")
                if not repo_name:
                    return _err("'name' is required")
                if any(r.name == repo_name for r in team.repositories):
                    logger.warning(f"POST repositories -> '{repo_name}' already exists in team '{team_name}'")
                    return _err(f"Repository '{repo_name}' already exists in team", 409)
                logger.info(f"POST /config/teams/{team_name}/repositories -> adding '{repo_name}'")
                repo = Repository.from_dict(body)
                team.repositories.append(repo)
                _write_config(config)
                setup_pr_url: Optional[str] = None
                webhook_id: Optional[int] = None
                github_errors: Dict[str, str] = {}
                try:
                    client = _get_github_client()
                    try:
                        setup_pr_url = client.create_setup_pr(repo_name, team.to_dict())
                        logger.info(f"Opened setup PR for {repo_name}: {setup_pr_url}")
                    except Exception as e:
                        logger.warning(f"create_setup_pr failed for {repo_name}: {e}")
                        github_errors["setup_pr"] = str(e)
                    try:
                        webhook_id = client.create_webhook(repo_name, repo.github_secret)
                        logger.info(f"Created webhook {webhook_id} for {repo_name}")
                    except Exception as e:
                        logger.warning(f"create_webhook failed for {repo_name}: {e}")
                        github_errors["webhook"] = str(e)
                except Exception as e:
                    logger.warning(f"GitHub client init failed: {e}")
                    github_errors["client"] = str(e)
                response: Dict[str, Any] = {
                    "repositories": [r.to_dict() for r in team.repositories],
                    "setup_pr_url": setup_pr_url,
                    "webhook_id": webhook_id,
                }
                if github_errors:
                    response["github_errors"] = github_errors
                return _ok(response, 201)

        # --- /config/teams/{teamName}/repositories/{repoName} ---
        repo_name: str = params.get("repoName", "")
        if path == f"/config/teams/{team_name}/repositories/{repo_name}" and team_name and repo_name:
            config = _read_config()
            team = config.find_team(team_name)
            if not team:
                logger.warning(f"DELETE repositories/{repo_name} -> team '{team_name}' not found")
                return _err(f"Team '{team_name}' not found", 404)
            if method == "DELETE":
                if not any(r.name == repo_name for r in team.repositories):
                    logger.warning(f"DELETE repositories/{repo_name} -> not found in team '{team_name}'")
                    return _err(f"Repository '{repo_name}' not found in team", 404)
                logger.info(f"DELETE /config/teams/{team_name}/repositories/{repo_name}")
                team.repositories = [r for r in team.repositories if r.name != repo_name]
                _write_config(config)
                removal_pr_url: Optional[str] = None
                removal_pr_error: Optional[str] = None
                try:
                    client = _get_github_client()
                    removal_pr_url = client.delete_setup_files(repo_name, team_name)
                    logger.info(f"Opened removal PR for {repo_name}: {removal_pr_url}")
                except Exception as e:
                    logger.warning(f"delete_setup_files failed for {repo_name}: {e}")
                    removal_pr_error = str(e)
                response = {"deleted": repo_name, "setup_pr_url": removal_pr_url}
                if removal_pr_error:
                    response["setup_pr_error"] = removal_pr_error
                return _ok(response)

        # --- /config/teams/{teamName}/buddies ---
        if path == f"/config/teams/{team_name}/buddies" and team_name:
            config = _read_config()
            team = config.find_team(team_name)
            if not team:
                logger.warning(f"PUT /config/teams/{team_name}/buddies -> team not found")
                return _err(f"Team '{team_name}' not found", 404)
            if method == "PUT":
                buddies = body.get("buddies")
                if not isinstance(buddies, dict):
                    return _err("'buddies' must be an object mapping GitHub usernames")
                logger.info(f"PUT /config/teams/{team_name}/buddies -> updating {len(buddies)} buddy mapping(s)")
                team.buddies = buddies
                _write_config(config)
                return _ok({"buddies": team.buddies})

        # --- /config/teams/{teamName}/username-mappings ---
        if path == f"/config/teams/{team_name}/username-mappings" and team_name:
            config = _read_config()
            team = config.find_team(team_name)
            if not team:
                logger.warning(f"PUT /config/teams/{team_name}/username-mappings -> team not found")
                return _err(f"Team '{team_name}' not found", 404)
            if method == "PUT":
                mappings = body.get("username_mappings")
                if not isinstance(mappings, dict):
                    return _err("'username_mappings' must be an object mapping GitHub to Discord usernames")
                logger.info(f"PUT /config/teams/{team_name}/username-mappings -> updating {len(mappings)} mapping(s)")
                team.username_mappings = mappings
                _write_config(config)
                return _ok({"username_mappings": team.username_mappings})

        logger.warning(f"No route matched: {method} {path}")
        return _err("Not found", 404)

    except Exception as e:
        logger.exception(f"Unhandled error for {method} {path}: {e}")
        return _err(str(e), 500)
