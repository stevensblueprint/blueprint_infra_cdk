# Blueprint Infrastructure

This repository contains the Infrastructure as Code (IaC) for the Blueprint platform, built using [AWS CDK](https://aws.amazon.com/cdk/) and TypeScript.

It provisions a comprehensive serverless environment including centralized authentication, billing monitoring, and automated deployment pipelines for multiple websites.

## Documentation

- **[Architecture Overview](./docs/architecture.md)**: High-level design and stack breakdown.
- **[Configuration Guide](./docs/configuration.md)**: How to configure the environment variables (`.env`).
- **[Deployment Guide](./docs/deployment.md)**: Step-by-step instructions for deploying to AWS.
- **[Email Forwarding & Discord Integration](./docs/email_forwarding.md)**: How to configure inbound email rules and forwarding.
- **[Password Manager Architecture](./docs/password_manager.md)**: Specifics of the Password Manager application.

## Quick Start

1.  **Install Dependencies:**
    ```bash
    npm install
    ```

2.  **Configure Environment:**
    Copy `.env.example` (if exists) or create `.env` following the [Configuration Guide](./docs/configuration.md).

3.  **Deploy:**
    ```bash
    cdk deploy --all
    ```

## Speeding up deployments
AWS lets you deploy stacks concurrently. The dependencies will be respected
```bash
cdk deploy --all --concurrency 3
```

## Development

- `npm run build`: Compile TypeScript to JavaScript.
- `npm run watch`: Watch for changes and compile.
- `npm run test`: Perform Jest unit tests.
- `npx cdk diff`: Compare deployed stack with current state.
- `npx cdk synth`: Emit the synthesized CloudFormation template.

## Project Structure

- `bin/`: CDK App entry point and configuration parsing.
- `lib/stacks/`: CloudFormation Stack definitions.
- `lib/constructs/`: Reusable CDK constructs.
- `lambda/`: Source code for AWS Lambda functions.
- `docs/`: Project documentation.