import json
import os
import uuid
from datetime import datetime, timezone
from typing import Dict, Any, List

import boto3
from botocore.exceptions import ClientError

TABLE_NAME = os.environ["PASSWORD_ENTRIES_TABLE_NAME"]

ddb = boto3.resource("dynamodb")
table = ddb.Table(TABLE_NAME)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _response(status: int, body: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "statusCode": status,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
        },
        "body": json.dumps(body),
    }


def _get_user_id(event: Dict[str, Any]) -> str:
    """
    Extract Cognito user id (sub) from API Gateway authorizer context.
    """
    try:
        return event["requestContext"]["authorizer"]["claims"]["sub"]
    except KeyError:
        raise ValueError("Unauthorized: missing Cognito claims")


def _parse_body(event: Dict[str, Any]) -> Dict[str, Any]:
    if not event.get("body"):
        raise ValueError("Request body is required")

    try:
        return json.loads(event["body"])
    except json.JSONDecodeError:
        raise ValueError("Invalid JSON body")


def _handle_create_password(user_id: str, body: Dict[str, Any]) -> Dict[str, Any]:
    required_fields = ["label", "username", "ciphertext", "kmsKeyId"]

    for field in required_fields:
        if field not in body:
            raise ValueError(f"Missing required field: {field}")

    entry_id = str(uuid.uuid4())
    now = _now_iso()

    item = {
        "PK": f"USER#{user_id}",
        "SK": f"ENTRY#{entry_id}",
        "entryId": entry_id,
        "label": body["label"],
        "username": body["username"],
        "url": body.get("url"),
        "notes": body.get("notes"),
        "ciphertext": body["ciphertext"],
        "kmsKeyId": body["kmsKeyId"],
        "encryptionContext": body.get("encryptionContext", {}),
        "createdAt": now,
        "updatedAt": now,
        "version": 1,
    }

    try:
        table.put_item(Item=item)
    except ClientError as e:
        raise RuntimeError(f"DynamoDB error: {e}")

    return _response(
        201,
        {
            "entryId": entry_id,
            "createdAt": now,
        },
    )


def _handle_list_passwords(user_id: str) -> Dict[str, Any]:
    try:
        resp = table.query(
            KeyConditionExpression="PK = :pk AND begins_with(SK, :sk)",
            ExpressionAttributeValues={
                ":pk": f"USER#{user_id}",
                ":sk": "ENTRY#",
            },
        )
    except ClientError as e:
        raise RuntimeError(f"DynamoDB error: {e}")

    items: List[Dict[str, Any]] = resp.get("Items", [])
    items.sort(key=lambda x: x.get("createdAt", ""), reverse=True)

    return _response(
        200,
        {
            "items": [
                {
                    "entryId": i["entryId"],
                    "label": i["label"],
                    "username": i["username"],
                    "url": i.get("url"),
                    "notes": i.get("notes"),
                    "ciphertext": i["ciphertext"],
                    "kmsKeyId": i["kmsKeyId"],
                    "encryptionContext": i.get("encryptionContext", {}),
                    "createdAt": i["createdAt"],
                    "updatedAt": i["updatedAt"],
                }
                for i in items
            ]
        },
    )


def handler(event: Dict[str, Any], context) -> Dict[str, Any]:
    try:
        user_id = _get_user_id(event)
        method = event["httpMethod"]
        path = event["resource"]

        if path == "/passwords" and method == "POST":
            body = _parse_body(event)
            return _handle_create_password(user_id, body)

        if path == "/passwords" and method == "GET":
            return _handle_list_passwords(user_id)

        return _response(404, {"message": "Not Found"})

    except ValueError as e:
        return _response(400, {"error": str(e)})

    except Exception as e:
        return _response(500, {"error": "Internal server error"})
