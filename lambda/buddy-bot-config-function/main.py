import boto3
import json
import os

sm = boto3.client("secretsmanager")
SECRET_ARN = os.environ["TEAM_CONFIG_SECRET_ARN"]


def _read_config():
    return json.loads(sm.get_secret_value(SecretId=SECRET_ARN)["SecretString"])


def _write_config(config):
    sm.put_secret_value(SecretId=SECRET_ARN, SecretString=json.dumps(config))


def _ok(body, status=200):
    return {
        "statusCode": status,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(body),
    }


def _err(message, status=400):
    return {
        "statusCode": status,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps({"error": message}),
    }


def _find_team(config, team_name):
    for team in config.get("teams", []):
        if team.get("name") == team_name:
            return team
    return None


def handler(event, context):
    method = event.get("httpMethod", "")
    path = event.get("path", "")
    params = event.get("pathParameters") or {}
    raw_body = event.get("body") or "{}"
    try:
        body = json.loads(raw_body)
    except json.JSONDecodeError:
        return _err("Invalid JSON body")

    try:
        # --- /config ---
        if path == "/config":
            if method == "GET":
                return _ok(_read_config())
            if method == "PUT":
                if not isinstance(body, dict) or "teams" not in body:
                    return _err("Body must be an object with a 'teams' key")
                _write_config(body)
                return _ok(body)

        # --- /config/settings ---
        if path == "/config/settings":
            config = _read_config()
            if method == "GET":
                return _ok({"settings": config.get("settings", {})})
            if method == "PUT":
                config["settings"] = body
                _write_config(config)
                return _ok({"settings": config["settings"]})

        # --- /config/teams ---
        if path == "/config/teams":
            config = _read_config()
            if method == "GET":
                return _ok({"teams": config.get("teams", [])})
            if method == "POST":
                name = body.get("name")
                if not name:
                    return _err("'name' is required")
                if _find_team(config, name):
                    return _err(f"Team '{name}' already exists", 409)
                team = {"name": name, "repositories": [], "buddies": [], "username_mappings": {}, **body}
                config.setdefault("teams", []).append(team)
                _write_config(config)
                return _ok(team, 201)

        # --- /config/teams/{teamName} ---
        team_name = params.get("teamName")
        if path == f"/config/teams/{team_name}" and team_name:
            config = _read_config()
            team = _find_team(config, team_name)
            if method == "GET":
                if not team:
                    return _err(f"Team '{team_name}' not found", 404)
                return _ok(team)
            if method == "PUT":
                if not team:
                    return _err(f"Team '{team_name}' not found", 404)
                body["name"] = team_name
                config["teams"] = [body if t["name"] == team_name else t for t in config["teams"]]
                _write_config(config)
                return _ok(body)
            if method == "DELETE":
                if not team:
                    return _err(f"Team '{team_name}' not found", 404)
                config["teams"] = [t for t in config["teams"] if t["name"] != team_name]
                _write_config(config)
                return _ok({"deleted": team_name})

        # --- /config/teams/{teamName}/repositories ---
        if path == f"/config/teams/{team_name}/repositories" and team_name:
            config = _read_config()
            team = _find_team(config, team_name)
            if not team:
                return _err(f"Team '{team_name}' not found", 404)
            if method == "GET":
                return _ok({"repositories": team.get("repositories", [])})
            if method == "POST":
                repo = body.get("name") or body.get("repository")
                if not repo:
                    return _err("'name' is required")
                repos = team.setdefault("repositories", [])
                if repo in repos:
                    return _err(f"Repository '{repo}' already exists in team", 409)
                repos.append(repo)
                _write_config(config)
                return _ok({"repositories": repos}, 201)

        # --- /config/teams/{teamName}/repositories/{repoName} ---
        repo_name = params.get("repoName")
        if path == f"/config/teams/{team_name}/repositories/{repo_name}" and team_name and repo_name:
            config = _read_config()
            team = _find_team(config, team_name)
            if not team:
                return _err(f"Team '{team_name}' not found", 404)
            if method == "DELETE":
                repos = team.get("repositories", [])
                if repo_name not in repos:
                    return _err(f"Repository '{repo_name}' not found in team", 404)
                team["repositories"] = [r for r in repos if r != repo_name]
                _write_config(config)
                return _ok({"deleted": repo_name})

        # --- /config/teams/{teamName}/buddies ---
        if path == f"/config/teams/{team_name}/buddies" and team_name:
            config = _read_config()
            team = _find_team(config, team_name)
            if not team:
                return _err(f"Team '{team_name}' not found", 404)
            if method == "PUT":
                buddies = body.get("buddies")
                if buddies is None:
                    return _err("'buddies' key is required")
                team["buddies"] = buddies
                _write_config(config)
                return _ok({"buddies": team["buddies"]})

        # --- /config/teams/{teamName}/username-mappings ---
        if path == f"/config/teams/{team_name}/username-mappings" and team_name:
            config = _read_config()
            team = _find_team(config, team_name)
            if not team:
                return _err(f"Team '{team_name}' not found", 404)
            if method == "PUT":
                mappings = body.get("username_mappings")
                if mappings is None:
                    return _err("'username_mappings' key is required")
                team["username_mappings"] = mappings
                _write_config(config)
                return _ok({"username_mappings": team["username_mappings"]})

        return _err("Not found", 404)

    except Exception as e:
        return _err(str(e), 500)
