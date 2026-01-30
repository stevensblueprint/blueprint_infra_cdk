# Configuration Guide

This project relies on environment variables for configuration. You should define these in a `.env` file in the project root.

## Environment Variables

| Variable | Required | Description | Example |
| :--- | :--- | :--- | :--- |
| `ACCOUNT_ID` | Yes | Your 12-digit AWS Account ID. | `123456789012` |
| `AWS_REGION` | No | AWS Region to deploy to. Defaults to `us-east-1`. | `us-east-1` |
| `SENDER_EMAIL` | Yes | Email address used for sending notifications (e.g., billing reports). Must be verified in SES if in sandbox. | `admin@example.com` |
| `RECIPIENT_EMAILS` | Yes | Comma-separated list of emails to receive notifications. | `user1@example.com,user2@example.com` |
| `DOMAIN_NAME` | Yes | The root domain name for your infrastructure. | `example.com` |
| `CERTIFICATE_ARN` | Yes | ARN of an ACM Certificate for the domain (must cover subdomains too, e.g., `*.example.com`). | `arn:aws:acm:us-east-1:123...:certificate/...` |
| `GITHUB_OWNER` | Yes | The GitHub organization or username that owns the repositories. | `my-org` |
| `NOTION_TOKEN` | Yes | Token for Notion integration (if applicable). | `secret_...` |
| `WEBSITES` | Yes | A **JSON string** defining the websites to deploy. | See below |

## WEBSITES JSON Structure

The `WEBSITES` variable must be a valid JSON array of objects stringified.

### Schema

```typescript
Array<{
  name: string;                   // Unique name for the website stack
  subdomain: string;              // Subdomain (e.g., "app" for app.example.com)
  githubRepositoryName?: string;  // (Optional) GitHub repo name for source
  githubBranchName?: string;      // (Optional) Branch to deploy from
  requiresAuth?: boolean;         // (Optional) Whether to put behind Cognito Auth. Default: false
}>
```

### Example `.env` entry

**Note:** Since `.env` files don't support multi-line JSON easily, it is recommended to minify the JSON string.

**Special Names:**
- If you use `"name": "vault"`, the infrastructure will automatically provision the **Password Manager Backend** (DynamoDB, Lambda, API Gateway) alongside the website.

**Readable JSON:**
```json
[
  {
    "name": "vault",
    "subdomain": "passwords",
    "requiresAuth": true
  },
  {
    "name": "Marketing Site",
    "subdomain": "www",
    "githubRepositoryName": "my-marketing-site",
    "githubBranchName": "main"
  }
]
```

**In `.env` file:**
```bash
WEBSITES='[{"name":"vault","subdomain":"passwords","requiresAuth":true},{"name":"Marketing Site","subdomain":"www","githubRepositoryName":"my-marketing-site","githubBranchName":"main"}]'
```

## Setup

1. Copy the example file (if available) or create a new one:
   ```bash
   cp .env.example .env
   ```
2. Fill in the values as described above.
