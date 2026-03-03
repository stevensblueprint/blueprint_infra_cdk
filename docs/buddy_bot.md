# Buddy Bot

## Overview

Buddy Bot is a GitHub PR reviewer assignment system. When a pull request is opened, a GitHub Actions workflow reads `.github/buddies.json` to find the author's assigned reviewer and requests their review automatically. A separate reminder Lambda sends a Discord notification if the PR remains unreviewed after a configurable threshold.

It has two main components:

1. **Webhook Handler** (`BuddyHandler`) — a Lambda Function URL that receives GitHub webhook events and schedules Discord reminders via EventBridge.
2. **Config API** (`BuddyBotConfigApi`) — a Cognito-authenticated REST API that manages the `buddy-bot/team-config` secret in Secrets Manager. Adding a repository automatically creates a GitHub webhook and opens a setup PR on the target repo.

---

## Architecture

```
GitHub Webhook ──► BuddyHandler (Lambda Function URL)
                        │
                        ├── reads TeamConfigSecret (Secrets Manager)
                        └── creates EventBridge Schedule
                                    │
                                    └── PullRequestReminderCron (Lambda)
                                                │
                                                └── sends Discord notification

PR opened ──► .github/workflows/assign-buddy.yml (GitHub Actions)
                        │
                        └── reads .github/buddies.json
                                    │
                                    └── requests review from assigned buddy

Cognito User ──► [JWT] ──► BuddyBotConfigApi (API Gateway)
                                    │
                                    └── BuddyBotConfigHandler (Lambda)
                                                ├── reads/writes TeamConfigSecret
                                                └── on repo add: creates webhook + setup PR
```

---

## Authentication

The Config API requires a valid Cognito JWT in the `Authorization` header of every request.

```bash
TOKEN=$(aws cognito-idp initiate-auth \
  --auth-flow USER_PASSWORD_AUTH \
  --client-id <UserPoolClientId> \
  --auth-parameters USERNAME=<email>,PASSWORD=<password> \
  --query 'AuthenticationResult.IdToken' \
  --output text)

curl -H "Authorization: $TOKEN" <BuddyBotConfigApiUrl>/config
```

---

## Data Model

The `buddy-bot/team-config` secret stores a JSON object with the following schema:

```json
{
  "settings": {
    "reminder_threshold_days": 1
  },
  "teams": [
    {
      "name": "team-alpha",
      "discord_webhook_url": "https://discord.com/api/webhooks/...",
      "repositories": [
        { "name": "org/repo-one", "github_secret": "whsec_..." },
        { "name": "org/repo-two", "github_secret": "whsec_..." }
      ],
      "team_leads": ["github-user-a"],
      "buddies": {
        "github-user-a": "github-user-b",
        "github-user-c": "github-user-d"
      },
      "username_mappings": {
        "github-user-a": "discord-user-a",
        "github-user-b": "discord-user-b"
      }
    }
  ]
}
```

### Fields

| Field | Type | Description |
|-------|------|-------------|
| `settings.reminder_threshold_days` | number | Days after PR creation before sending a Discord reminder |
| `teams[].name` | string | Unique team identifier |
| `teams[].discord_webhook_url` | string | Discord webhook URL for reminder notifications |
| `teams[].repositories` | object[] | Repos to monitor; each has `name` (`org/repo`) and `github_secret` (HMAC signing secret for webhook verification) |
| `teams[].team_leads` | string[] | GitHub usernames of team leads |
| `teams[].buddies` | object | Map of GitHub username → assigned reviewer's GitHub username. Written to `.github/buddies.json` in each repo. |
| `teams[].username_mappings` | object | Map of GitHub username → Discord username for reminder mentions |

### Repository files

When a repository is added, the API opens a PR on it containing:

| File | Content |
|------|---------|
| `.github/buddies.json` | The team's `buddies` map. The workflow reads this to assign reviewers. |
| `.github/workflows/assign-buddy.yml` | GitHub Actions workflow that fires on `pull_request` and requests a review from the author's assigned buddy. |

---

## API Endpoints

**Base URL:** `BuddyBotConfigApiUrl` (CDK output)

All requests require `Authorization: <CognitoJWT>`.

All responses follow the shape `{ ...data }` on success or `{ "error": "message" }` on failure.

---

### Full Config

#### `GET /config`
Returns the full configuration.

**Response `200`:**
```json
{
  "settings": { "reminder_threshold_days": 1 },
  "teams": [ { "name": "team-alpha", "..." } ]
}
```

#### `PUT /config`
Replaces the entire configuration. Body must contain a `teams` key.

**Request:**
```json
{
  "settings": { "reminder_threshold_days": 2 },
  "teams": []
}
```

**Response `200`:** The saved configuration object.

---

### Settings

#### `GET /config/settings`

**Response `200`:**
```json
{ "settings": { "reminder_threshold_days": 1 } }
```

#### `PUT /config/settings`
Replaces the global settings.

**Request:**
```json
{ "reminder_threshold_days": 3 }
```

**Response `200`:**
```json
{ "settings": { "reminder_threshold_days": 3 } }
```

---

### Teams

#### `GET /config/teams`

**Response `200`:**
```json
{ "teams": [ { "name": "team-alpha", "..." } ] }
```

#### `POST /config/teams`
Creates a new team. `name` is required and must be unique.

**Request:**
```json
{
  "name": "team-alpha",
  "discord_webhook_url": "https://discord.com/api/webhooks/...",
  "repositories": [],
  "team_leads": ["alice"],
  "buddies": { "alice": "bob", "charlie": "dave" },
  "username_mappings": { "alice": "alice_discord", "bob": "bob_discord" }
}
```

**Response `201`:** The created team object.

---

#### `GET /config/teams/{teamName}`

**Response `200`:** The team object.

---

#### `PUT /config/teams/{teamName}`
Replaces a team's full configuration. The team must already exist; its `name` is preserved from the URL.

When repositories are added or removed, the API automatically opens GitHub PRs:
- **Added repos** — setup PR adding `.github/buddies.json` + `.github/workflows/assign-buddy.yml`
- **Removed repos** — removal PR deleting those files
- **Unchanged repos** — update PR refreshing `.github/buddies.json` with the latest buddy map

**Request:** Full team object (same shape as `POST /config/teams`).

**Response `200`:**
```json
{
  "name": "team-alpha",
  "...",
  "github_prs": {
    "org/repo-one": { "action": "updated", "pr_url": "https://github.com/..." },
    "org/repo-two": { "action": "deleted", "pr_url": "https://github.com/..." }
  }
}
```

If a PR could not be opened for a repo, that entry contains `"error"` instead of `"pr_url"`. The config is saved regardless.

---

#### `DELETE /config/teams/{teamName}`
Deletes a team and opens a removal PR on each of its repositories.

**Response `200`:**
```json
{
  "deleted": "team-alpha",
  "github_prs": {
    "org/repo-one": { "action": "deleted", "pr_url": "https://github.com/..." }
  }
}
```

---

### Repositories

#### `GET /config/teams/{teamName}/repositories`

**Response `200`:**
```json
{
  "repositories": [
    { "name": "org/repo-one", "github_secret": "whsec_..." }
  ]
}
```

---

#### `POST /config/teams/{teamName}/repositories`
Adds a repository to a team. On success, automatically:

1. **Creates a GitHub webhook** on the repository pointing to the BuddyHandler Function URL, signed with `github_secret`.
2. **Opens a setup PR** on the repository adding `.github/buddies.json` (the team's buddy map) and `.github/workflows/assign-buddy.yml`.

**Request:**
```json
{ "name": "org/new-repo", "github_secret": "whsec_..." }
```

> `github_secret` is a webhook signing secret you generate (e.g. `openssl rand -hex 20`). It is used to verify `X-Hub-Signature-256` on incoming webhook events.

**Response `201`:**
```json
{
  "repositories": [
    { "name": "org/repo-one", "github_secret": "whsec_..." },
    { "name": "org/new-repo", "github_secret": "whsec_..." }
  ],
  "setup_pr_url": "https://github.com/org/new-repo/pull/1",
  "webhook_id": 12345678
}
```

If either the PR or the webhook could not be created, the corresponding field is `null` and `github_errors` is populated with a per-operation error message. The repository is still saved to the config.

```json
{
  "repositories": [ "..." ],
  "setup_pr_url": null,
  "webhook_id": null,
  "github_errors": {
    "setup_pr": "GitHub API 404: Not Found",
    "webhook": "GitHub API 403: Must have admin rights to Repository"
  }
}
```

---

#### `DELETE /config/teams/{teamName}/repositories/{repoName}`
Removes a repository and opens a PR on it to delete the setup files.

> `repoName` must be URL-encoded, e.g. `org%2Frepo-one`.

**Response `200`:**
```json
{
  "deleted": "org/repo-one",
  "setup_pr_url": "https://github.com/org/repo-one/pull/5"
}
```

---

### Buddies

#### `PUT /config/teams/{teamName}/buddies`
Replaces the entire buddy map for a team. Each key is the PR author; the value is their assigned reviewer.

**Request:**
```json
{
  "buddies": {
    "github-user-a": "github-user-b",
    "github-user-c": "github-user-d"
  }
}
```

**Response `200`:**
```json
{ "buddies": { "github-user-a": "github-user-b", "..." } }
```

> To propagate the updated buddy map to all repos, follow up with `PUT /config/teams/{teamName}`.

---

### Username Mappings

#### `PUT /config/teams/{teamName}/username-mappings`
Replaces the GitHub → Discord username mapping for a team.

**Request:**
```json
{
  "username_mappings": {
    "github-user-a": "discord-user-a",
    "github-user-b": "discord-user-b"
  }
}
```

**Response `200`:**
```json
{ "username_mappings": { "github-user-a": "discord-user-a", "..." } }
```

---

## Setup Instructions

### 1. Deploy the stack

```bash
npx cdk deploy blueprint-github-stack
```

Note the outputs: `BuddyBotConfigApiUrl`, `PRReminderFunctionUrl`.

### 2. Populate the GitHub API token

The token is used by `BuddyBotConfigHandler` to create webhooks and open PRs. It requires `repo` scope (or at minimum `contents:write`, `pull_requests:write`, and `admin:repo_hook`).

```bash
aws secretsmanager put-secret-value \
  --secret-id buddy-bot/github-token \
  --secret-string "ghp_your_token_here"
```

### 3. Obtain a Cognito JWT

```bash
TOKEN=$(aws cognito-idp initiate-auth \
  --auth-flow USER_PASSWORD_AUTH \
  --client-id <UserPoolClientId> \
  --auth-parameters USERNAME=<email>,PASSWORD=<password> \
  --query 'AuthenticationResult.IdToken' \
  --output text)
```

### 4. Create a team

```bash
API_URL="<BuddyBotConfigApiUrl>"

curl -s -X POST "$API_URL/config/teams" \
  -H "Authorization: $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "my-team",
    "discord_webhook_url": "https://discord.com/api/webhooks/...",
    "team_leads": ["alice"],
    "buddies": { "alice": "bob", "charlie": "dave" },
    "username_mappings": { "alice": "alice_discord", "bob": "bob_discord" }
  }'
```

### 5. Add a repository

Generate a webhook signing secret, then add the repository:

```bash
SECRET=$(openssl rand -hex 20)

curl -s -X POST "$API_URL/config/teams/my-team/repositories" \
  -H "Authorization: $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"name\": \"my-org/my-repo\", \"github_secret\": \"$SECRET\"}"
```

The response contains `setup_pr_url` and `webhook_id`. Review and merge the setup PR on the repository — no further manual webhook configuration is needed.

---

## Security Notes

- The Config API requires a valid Cognito JWT — unauthenticated requests are rejected at the API Gateway level, with CORS headers included on error responses so browsers receive a proper 401/403 rather than a network error.
- `BuddyBotConfigHandler` has least-privilege IAM: `GetSecretValue` + `PutSecretValue` on `buddy-bot/team-config`, and `GetSecretValue` on `buddy-bot/github-token`.
- `BuddyHandler` has no auth on its Function URL since GitHub delivers webhooks directly. All incoming payloads are verified against `X-Hub-Signature-256` using the per-repo `github_secret`.
- CORS is set to `*` (all origins). Restrict `allowOrigins` in `PullRequestReminderConstruct` if you want to limit Config API access to specific domains.
