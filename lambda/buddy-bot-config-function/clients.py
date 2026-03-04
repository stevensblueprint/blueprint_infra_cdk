import json
import logging
import time
import urllib.error
import urllib.request
from base64 import b64encode
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

ASSETS_DIR = Path(__file__).parent / "assets"

logger = logging.getLogger(__name__)


class GithubClient:
    def __init__(self, token: str, webhook_url: str) -> None:
        self._token = token
        self._webhook_url = webhook_url
        raw_workflow = (ASSETS_DIR / "buddy-bot.yml").read_text()
        self._workflow_content = raw_workflow.replace("__BUDDY_BOT_URL__", webhook_url)

    def create_setup_pr(self, full_repo_name: str, team: Dict[str, Any]) -> str:
        """Open a PR adding .github/buddy-bot.json and .github/workflows/buddy-bot.yml."""
        logger.info(f"create_setup_pr: repo={full_repo_name} team={team['name']}")
        owner, repo = self._parse(full_repo_name)
        branch = "chore/buddy-bot-setup"
        default_branch, head_sha = self._default_branch(owner, repo)
        logger.info(f"create_setup_pr: default_branch={default_branch} head_sha={head_sha}")
        self._create_branch(owner, repo, branch, head_sha)
        self._put_file(
            owner,
            repo,
            ".github/buddies.json",
            self._buddy_bot_json(team),
            "chore: add buddy-bot config",
            branch,
        )
        self._put_file(
            owner,
            repo,
            ".github/workflows/assign-buddy.yml",
            self._workflow_content,
            "chore: add buddy-bot PR notification workflow",
            branch,
        )
        pr_url = self._open_pr(
            owner,
            repo,
            title="chore: set up Buddy Bot PR notifications",
            head=branch,
            base=default_branch,
            body=self._setup_pr_body(team),
        )
        logger.info(f"create_setup_pr: PR opened -> {pr_url}")
        return pr_url

    def update_setup_files(self, full_repo_name: str, team: Dict[str, Any]) -> str:
        """Open a PR updating the buddy-bot setup files with the latest team config."""
        logger.info(f"update_setup_files: repo={full_repo_name} team={team['name']}")
        owner, repo = self._parse(full_repo_name)
        branch = f"chore/buddy-bot-update-{int(time.time())}"
        default_branch, head_sha = self._default_branch(owner, repo)
        logger.info(f"update_setup_files: default_branch={default_branch} branch={branch}")
        self._create_branch(owner, repo, branch, head_sha)
        self._put_file(
            owner,
            repo,
            ".github/buddies.json",
            self._buddy_bot_json(team),
            "chore: update buddy-bot config",
            branch,
        )
        self._put_file(
            owner,
            repo,
            ".github/workflows/assign-buddy.yml",
            self._workflow_content,
            "chore: update buddy-bot PR notification workflow",
            branch,
        )
        pr_url = self._open_pr(
            owner,
            repo,
            title="chore: update Buddy Bot setup files",
            head=branch,
            base=default_branch,
            body=f"Updates the Buddy Bot configuration for team `{team['name']}`.",
        )
        logger.info(f"update_setup_files: PR opened -> {pr_url}")
        return pr_url

    def delete_setup_files(self, full_repo_name: str, team_name: str) -> str:
        """Open a PR removing the buddy-bot setup files."""
        logger.info(f"delete_setup_files: repo={full_repo_name} team={team_name}")
        owner, repo = self._parse(full_repo_name)
        branch = "chore/buddy-bot-remove"
        default_branch, head_sha = self._default_branch(owner, repo)
        logger.info(f"delete_setup_files: default_branch={default_branch}")
        self._create_branch(owner, repo, branch, head_sha)
        for path in [".github/buddies.json", ".github/workflows/assign-buddy.yml"]:
            existing = self._get_file(owner, repo, path, branch)
            if existing:
                logger.info(f"delete_setup_files: deleting {path} (sha={existing['sha']})")
                self._delete_file(
                    owner, repo, path, f"chore: remove {path}", branch, existing["sha"]
                )
            else:
                logger.info(f"delete_setup_files: {path} not found, skipping")
        pr_url = self._open_pr(
            owner,
            repo,
            title="chore: remove Buddy Bot setup",
            head=branch,
            base=default_branch,
            body=f"Removes Buddy Bot PR notifications for team `{team_name}`. This repository will no longer send events to the buddy bot.",
        )
        logger.info(f"delete_setup_files: PR opened -> {pr_url}")
        return pr_url

    def create_webhook(self, full_repo_name: str, secret: str) -> int:
        """Register a pull_request webhook on the repo pointing to the Buddy Bot Function URL.

        Returns the created webhook ID.
        """
        logger.info(f"create_webhook: repo={full_repo_name}")
        owner, repo = self._parse(full_repo_name)
        result = self._api(
            "POST",
            f"/repos/{owner}/{repo}/hooks",
            {
                "name": "web",
                "active": True,
                "events": ["pull_request"],
                "config": {
                    "url": self._webhook_url,
                    "content_type": "json",
                    "secret": secret,
                },
            },
        )
        webhook_id = result["id"]
        logger.info(f"create_webhook: created webhook id={webhook_id} for {full_repo_name}")
        return webhook_id

    @staticmethod
    def _parse(full_repo_name: str) -> Tuple[str, str]:
        owner, repo = full_repo_name.split("/", 1)
        return owner, repo

    def _api(self, method: str, path: str, data: Optional[Dict] = None) -> Dict:
        logger.info(f"GitHub API: {method} {path}")
        body = json.dumps(data).encode() if data is not None else None
        req = urllib.request.Request(
            f"https://api.github.com{path}",
            data=body,
            headers={
                "Authorization": f"Bearer {self._token}",
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
                "Content-Type": "application/json",
            },
            method=method,
        )
        try:
            with urllib.request.urlopen(req) as resp:
                result = json.loads(resp.read())
                logger.info(f"GitHub API: {method} {path} -> {resp.status}")
                return result
        except urllib.error.HTTPError as e:
            error_body = json.loads(e.read())
            message = error_body.get("message", str(e))
            logger.error(f"GitHub API error: {method} {path} -> {e.code}: {message}")
            raise RuntimeError(f"GitHub API {e.code}: {message}")

    def _default_branch(self, owner: str, repo: str) -> Tuple[str, str]:
        """Return (branch_name, head_sha) for the default branch."""
        repo_data = self._api("GET", f"/repos/{owner}/{repo}")
        branch = repo_data["default_branch"]
        ref_data = self._api("GET", f"/repos/{owner}/{repo}/git/refs/heads/{branch}")
        sha = ref_data["object"]["sha"]
        logger.info(f"_default_branch: {owner}/{repo} -> branch={branch} sha={sha}")
        return branch, sha

    def _create_branch(self, owner: str, repo: str, branch: str, sha: str) -> None:
        logger.info(f"_create_branch: {owner}/{repo} branch={branch} from sha={sha}")
        self._api(
            "POST",
            f"/repos/{owner}/{repo}/git/refs",
            {
                "ref": f"refs/heads/{branch}",
                "sha": sha,
            },
        )

    def _get_file(self, owner: str, repo: str, path: str, ref: str) -> Optional[Dict]:
        try:
            result = self._api("GET", f"/repos/{owner}/{repo}/contents/{path}?ref={ref}")
            logger.info(f"_get_file: {path} found (sha={result.get('sha')})")
            return result
        except RuntimeError:
            logger.info(f"_get_file: {path} not found")
            return None

    def _put_file(
        self, owner: str, repo: str, path: str, content: str, message: str, branch: str
    ) -> None:
        """Create or update a file, automatically resolving the existing SHA if needed."""
        payload: Dict[str, Any] = {
            "message": message,
            "content": b64encode(content.encode()).decode(),
            "branch": branch,
        }
        existing = self._get_file(owner, repo, path, branch)
        if existing:
            payload["sha"] = existing["sha"]
            logger.info(f"_put_file: updating {path} on {branch}")
        else:
            logger.info(f"_put_file: creating {path} on {branch}")
        self._api("PUT", f"/repos/{owner}/{repo}/contents/{path}", payload)

    def _delete_file(
        self, owner: str, repo: str, path: str, message: str, branch: str, sha: str
    ) -> None:
        logger.info(f"_delete_file: {path} on {branch} (sha={sha})")
        self._api(
            "DELETE",
            f"/repos/{owner}/{repo}/contents/{path}",
            {
                "message": message,
                "sha": sha,
                "branch": branch,
            },
        )

    def _open_pr(
        self, owner: str, repo: str, title: str, head: str, base: str, body: str
    ) -> str:
        result = self._api(
            "POST",
            f"/repos/{owner}/{repo}/pulls",
            {
                "title": title,
                "head": head,
                "base": base,
                "body": body,
            },
        )
        return result["html_url"]

    @staticmethod
    def _buddy_bot_json(team: Dict[str, Any]) -> str:
        # The workflow reads this file as buddyMap[author] → reviewer, so the
        # content must be the raw buddies dict: {"alice": "bob", ...}
        return json.dumps(team.get("buddies", {}), indent=2) + "\n"

    @staticmethod
    def _setup_pr_body(team: Dict[str, Any]) -> str:
        return f"""\
## Buddy Bot Setup

This PR wires up **Buddy Bot** PR notifications for the `{team['name']}` team.

### Files added

| File | Purpose |
|------|---------|
| `.github/buddy-bot.json` | Team metadata used by Buddy Bot |
| `.github/workflows/buddy-bot.yml` | Sends PR events to the Buddy Bot webhook |

### Required repository secret

Before merging, add the following secret under **Settings → Secrets and variables → Actions**:

| Secret name | Value |
|-------------|-------|
| `BUDDY_BOT_WEBHOOK_SECRET` | The `github_secret` you supplied when adding this repository to Buddy Bot |
"""
