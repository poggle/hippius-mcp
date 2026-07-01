# Security Policy

## Reporting a Vulnerability

Please report security issues privately to the repository owner. Do not open a public issue for leaked credentials, auth bypasses, or data exposure bugs.

## Credential Handling

This MCP server reads Hippius S3 credentials from environment variables or a local `.env` file. It does not need wallet seed phrases.

Never commit:

- `.env`
- Hippius access keys
- Hippius secret keys
- generated logs containing presigned URLs for sensitive objects

If credentials are exposed, rotate or revoke them in the Hippius console.

## Public Uploads

`public` mode uploads objects with `public-read` ACL. Anyone with the stable URL can read the object until it is deleted or made private outside this MCP.

`shareable` mode uploads private objects and returns presigned URLs. A presigned URL remains usable until it expires unless the object is deleted, moved, or credentials are rotated.
