# Email Forwarding & Discord Integration Guide

This guide explains how to configure inbound email forwarding to Discord channels and external email addresses.

## Overview

The infrastructure sets up an SES Inbound Rule Set that:
1. Receives emails for specific addresses at your domain (e.g., `info@yourdomain.com`).
2. Saves the raw email to an S3 bucket.
3. Triggers a Lambda function to:
   - Parse the email.
   - Post a summary to a Discord Webhook.
   - (Optional) Forward the email to a list of registered email addresses.

## Configuration

The configuration is managed via the `EMAIL_DISCORD_MAPPINGS` environment variable in your `.env` file.

### EMAIL_DISCORD_MAPPINGS Structure

This variable must be a **JSON array** of objects, where each key is the local part of the email address (the part before `@`).

```json
[
  {
    "support": {
      "webhookUrl": "https://discord.com/api/webhooks/...",
      "allowedSenderDomains": ["customer.com", "partner.io"],
      "forwardEmails": ["team-lead@gmail.com", "backup@company.com"]
    }
  },
  {
    "alerts": {
      "webhookUrl": "https://discord.com/api/webhooks/...",
      "allowedSenderDomains": []
    }
  }
]
```

- **`webhookUrl`**: The Discord webhook URL where notifications will be sent.
- **`allowedSenderDomains`**: (Optional) An array of domains. If provided, only emails from these domains will be processed. Empty array `[]` allows all domains.
- **`forwardEmails`**: (Optional) An array of email addresses to forward the content to.

### In `.env` file:
Minify the JSON for the `.env` file:
```bash
EMAIL_DISCORD_MAPPINGS='[{"support":{"webhookUrl":"...","allowedSenderDomains":[],"forwardEmails":["user@example.com"]}}]'
```

---

## SES Identity Registration

To send or forward emails using AWS SES, you must verify the identities (email addresses or domains).

### 1. Verify your Domain (Recommended)
If you verify your root domain (e.g., `yourdomain.com`), you can send/forward emails using any address at that domain.
1. Go to the [AWS SES Console](https://console.aws.amazon.com/ses/home).
2. Navigate to **Identities** -> **Create identity**.
3. Select **Domain** and enter `yourdomain.com`.
4. Follow the instructions to add the required DNS records (CNAMEs for DKIM) to your DNS provider.

### 2. Verify Forwarding Destination Emails
If your AWS SES account is in the **Sandbox** (default for new accounts), you **must** verify every email address you intend to forward emails *to*.
1. Go to **Identities** -> **Create identity**.
2. Select **Email address**.
3. Enter the recipient's email (e.g., `team-lead@gmail.com`).
4. The recipient will receive a verification email from AWS. They must click the link to confirm.

*Note: Once your SES account is moved out of the sandbox, you no longer need to verify destination addresses, only the sender identity.*

### 3. Verify the Forwarding Sender
The Lambda function uses `no-reply@yourdomain.com` as the default sender for forwarded emails. If you have verified your domain, this works automatically. If you haven't verified the domain, you must verify this specific email address.

---

## Adding or Updating Forwarded Emails

1. **Update `.env`**: Add the new email addresses to the `forwardEmails` array in your `EMAIL_DISCORD_MAPPINGS`.
2. **Verify in SES**: If in sandbox mode, ensure the new email addresses are verified as Identities in the SES console.
3. **Redeploy**: Run the deployment command to update the Lambda environment variables.
   ```bash
   npx cdk deploy blueprint-email-stack
   ```
