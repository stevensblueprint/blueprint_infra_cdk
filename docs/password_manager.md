# Password Manager — AWS Serverless System Overview

This repository contains a simple, secure password manager backend that lets authenticated users **view** and **add** password entries.

At a high level:
- **API**: Amazon API Gateway (REST) exposes endpoints
- **Auth**: Amazon Cognito issues JWTs; API requests are authorized via JWT validation
- **Storage**: Amazon DynamoDB stores **encrypted secrets** + metadata, with **Point-in-Time Recovery (PITR)** enabled
- **Encryption**: AWS KMS customer-managed key (CMK) is used to **encrypt/decrypt passwords client-side** (the backend stores ciphertext)

---

## Goals

- Allow users to:
  - Add password entries (e.g., website/app + username + password)
  - View saved entries (metadata and encrypted secret)
- Ensure:
  - Secrets are **never stored in plaintext**
  - Each user can access **only their own** entries
  - Storage is durable, auditable, and recoverable (PITR)

---

## Architecture

### Components

1. **Client (Web/Mobile/CLI)**
   - Authenticates user via Cognito (Hosted UI or SRP/password auth).
   - Receives `id_token` / `access_token` (JWT).
   - Encrypts/decrypts secrets using AWS KMS (client-side).
   - Calls API Gateway endpoints with `Authorization: Bearer <JWT>`.

2. **Amazon Cognito (User Pool)**
   - Manages users, sign-in, and JWT issuance.
   - Provides JWKS for signature verification.
   - Optional: groups/claims for future RBAC.

3. **Amazon API Gateway (REST API)**
   - Hosts RESTful routes (e.g., `/v1/passwords`).
   - Uses a Cognito authorizer to validate JWTs.
   - Passes the authenticated user identity (e.g., `sub`) to the backend.

4. **Backend Compute (e.g., AWS Lambda)**
   - Implements request handlers for add/view.
   - Enforces authorization using the user identity from the JWT claims.
   - Writes/reads items in DynamoDB.
   - Does **not** need plaintext secrets (stores ciphertext + metadata).

5. **Amazon DynamoDB**
   - Stores encrypted secrets (ciphertext) and entry metadata.
   - **Point-in-Time Recovery (PITR)** enabled for restore protection.
   - Access restricted by IAM (only backend can read/write the table).

6. **AWS KMS (Customer Managed Key)**
   - Used by the **client** to encrypt/decrypt password values.
   - Key policy restricts use to approved principals (e.g., the authenticated client role).
   - (Recommended) Encryption context includes `userId` and entry identifiers.

---

## Data Model (DynamoDB)

**Table: `PasswordEntries`** (example)

### Primary keys
- `PK` (partition key): `USER#<cognito_sub>`
- `SK` (sort key): `ENTRY#<entry_id>`

### Attributes (example)
- `entryId`: string (UUID)
- `createdAt`: ISO-8601 string
- `updatedAt`: ISO-8601 string
- `label`: string (e.g., “GitHub”, “Bank”)
- `username`: string
- `url`: string (optional)
- `notes`: string (optional, consider encrypting as well)
- `ciphertext`: string (base64-encoded encrypted secret, produced client-side)
- `kmsKeyId`: string (the CMK used)
- `encryptionContext`: map (e.g., `{ "userId": "<sub>", "entryId": "<uuid>" }`)
- `version`: number (optimistic concurrency / schema versioning)

> The table stores **ciphertext only**. If you store additional sensitive fields (notes, security questions, TOTP seeds), encrypt them too.

---

## API Surface (REST)

All endpoints require:
- `Authorization: Bearer <Cognito JWT>`

### `POST /v1/passwords`
Creates a new password entry.

**Request body (example)**
```json
{
  "label": "GitHub",
  "username": "miguel@example.com",
  "url": "https://github.com",
  "ciphertext": "BASE64_ENCRYPTED_PASSWORD",
  "kmsKeyId": "arn:aws:kms:...:key/...",
  "encryptionContext": { "userId": "<sub>", "entryId": "<uuid>" }
}
```

#### Response example
```json
{
  "entryId": "uuid",
  "createdAt": "2026-01-27T00:00:00Z"
}
```

### `GET /v1/passwords`
Lists entries for the authenticated user.
#### Response (example)
```json
{
  "items": [
    {
      "entryId": "uuid",
      "label": "GitHub",
      "username": "miguel@example.com",
      "url": "https://github.com",
      "createdAt": "2026-01-27T00:00:00Z",
      "updatedAt": "2026-01-27T00:00:00Z",
      "ciphertext": "BASE64_ENCRYPTED_PASSWORD",
      "kmsKeyId": "arn:aws:kms:...:key/..."
    }
  ]
}
```

## AuthN/AuthZ Model
- Users authenticate with Cognito User Pool and receive JWTs.
- API Gateway validates JWTs and forwards identity claims.
- Backend derives userId = claims.sub and uses it as the DynamoDB partition key.
- DynamoDB access is scoped so the backend can only operate on the table, while user-level access control is enforced in code by using USER#<sub>.

## Encryption Model (Client-Side with KMS)

Key idea: the client encrypts and decrypts secrets; the backend stores ciphertext.

Recommended flow:
1.  Client generates an entryId (UUID).
2.  Client calls KMS Encrypt using CMK:
    - plaintext: password (and optionally other sensitive fields)
    - encryption context: at minimum { "userId": "<sub>", "entryId": "<uuid>" }
3.	Client sends ciphertext + metadata to the API.
4.	When viewing:
    - client fetches ciphertext
    - client calls KMS Decrypt using the same encryption context
    - client renders plaintext locally

Benefits:
- The backend never needs plaintext secrets.
- Encryption context helps prevent ciphertext misuse outside intended scope.


## Reliability & Recovery
- DynamoDB PITR enabled: supports restoring the table to any second within the retention window.
- Consider also enabling:
- DynamoDB on-demand or autoscaling
- CloudWatch alarms (5XX from API GW, Lambda errors/throttles)
- Structured logging with request IDs

## Security Considerations
- Enforce HTTPS only (default for API Gateway).
- Use least-privilege IAM:
- Backend: only CRUD on the DynamoDB table
- Client KMS usage: only kms:Encrypt/kms:Decrypt on the CMK as needed
- Use short-lived tokens and consider refresh token flows where appropriate.
- Avoid logging secrets or ciphertext in plaintext logs.

## Typical Request Flow

Add password
1.	Client logs in via Cognito → gets JWT.
2.	Client encrypts password using KMS → ciphertext.
3.	Client calls POST /v1/passwords with JWT + ciphertext + metadata.
4.	Backend stores item in DynamoDB under USER#<sub>.

View passwords
1.	Client calls GET /v1/passwords with JWT.
2.	Backend returns items (ciphertext + metadata).
3.	Client decrypts ciphertext using KMS and displays plaintext locally.


## Future Enhancements (Optional)
- Search by label/username (GSI on labelLower or usernameLower)
- Versioning + history per entry
- Soft deletes + TTL for trash
- Audit trails (CloudTrail for KMS; structured app logs)
- Sharing vaults (requires a more complex key-sharing model)
- Client-side envelope encryption (DEK encrypted by KMS) for lower KMS costs at scale
