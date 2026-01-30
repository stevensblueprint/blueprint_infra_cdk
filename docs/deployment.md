# Deployment Guide

This guide details how to deploy the Blueprint Infrastructure to your AWS account.

## Prerequisites

Before you begin, ensure you have the following installed and configured:

1.  **Node.js** (v18 or later)
    ```bash
    node --version
    ```
2.  **AWS CLI** (configured with credentials)
    ```bash
    aws configure
    ```
3.  **AWS CDK Toolkit** (installed globally or use via `npx`)
    ```bash
    npm install -g aws-cdk
    ```

## Step 1: Install Dependencies

Navigate to the project root and install the necessary Node.js packages:

```bash
npm install
```

## Step 2: Configuration

Create a `.env` file in the root directory and configure it according to the [Configuration Guide](./configuration.md).

```bash
# Check if .env exists and has required variables
cat .env
```

## Step 3: AWS SES Verification

If your AWS account is in the **SES Sandbox** (which is the default for new accounts), you **must** verify the email addresses you intend to use.

1.  Go to the **Amazon SES** console.
2.  Navigate to **Identities**.
3.  Click **Create identity**.
4.  Verify the `SENDER_EMAIL` address.
5.  Verify each email address listed in `RECIPIENT_EMAILS`.
6.  You will receive a verification link in your inbox for each address. Click it to confirm.

**Note:** If you do not verify these emails, the Billing Report functionality will fail to send emails.

## Step 4: AWS CDK Bootstrap

If this is your first time using AWS CDK in this specific AWS account and region, you need to bootstrap it. This creates the necessary resources (S3 bucket, IAM roles) for CDK to manage deployments.

```bash
npx cdk bootstrap aws://<ACCOUNT_ID>/<AWS_REGION>
```
*Replace `<ACCOUNT_ID>` and `<AWS_REGION>` with your actual values.*

## Step 4: Verify Stacks

Before deploying, you can list the stacks that will be created to ensure your configuration is being picked up correctly.

```bash
npx cdk list
```

You should see output similar to:
- `blueprint-auth-stack`
- `blueprint-github-stack`
- `blueprint-billing-stack`
- `blueprint-Password-Manager-website-stack` (depending on your `WEBSITES` config)

## Step 5: Deploy

You can deploy all stacks at once:

```bash
npx cdk deploy --all
```

Or deploy specific stacks:

```bash
npx cdk deploy blueprint-auth-stack
```

Review the security changes (IAM roles/policies) prompted by CDK and confirm with `y`.

## Step 6: Post-Deployment Verification

1.  **CloudFormation Console:** Log in to the AWS Console and verify that the stacks are in `UPDATE_COMPLETE` or `CREATE_COMPLETE` status.
2.  **Route53:** Check that the DNS records for your subdomains have been created.
3.  **Certificates:** Ensure the ACM certificate is valid and attached to the CloudFront distributions.

## Step 7: Post-Deployment Configuration

### GitHub Token for PR Reminders
The `blueprint-github-stack` creates a placeholder secret in AWS Secrets Manager named `buddy-bot/github-token`.

1.  Go to the **AWS Secrets Manager** console.
2.  Find the secret named `buddy-bot/github-token`.
3.  Update the **Secret Value** with a valid GitHub Personal Access Token (PAT).
    - The PAT needs `repo:read` scope (or access to read pull requests) for the organizations/repositories you want to monitor.
    - The value should be a plain string (the token itself) or a JSON object depending on how the Lambda consumes it. (Default implementation expects the raw token or `{"token": "..."}`).

## Troubleshooting

### `WEBSITES` JSON Parse Error
If you see an error related to parsing `WEBSITES`, ensure that the JSON string in your `.env` file is valid and strictly uses double quotes `"` for keys and string values.

### Permissions Errors
Ensure your AWS CLI user has `AdministratorAccess` or sufficient permissions to creating IAM Roles, S3 Buckets, CloudFront distributions, and Lambda functions.
