# Hippius MCP

Local [Model Context Protocol](https://modelcontextprotocol.io/) server for uploading files or text to [Hippius](https://hippius.com) S3 storage.

It gives MCP clients such as Codex and Claude Code a simple way to:

- upload a local file and return a temporary share link
- upload a local file as a stable public URL
- upload generated text as a shareable or public object
- create a new share link for an existing object
- delete an uploaded object

This project uses Hippius's S3-compatible API at `https://s3.hippius.com`.

## Status

Early OSS release. The current server is intentionally small and local-first. It is not an official Hippius product unless this repository is transferred to, or explicitly maintained by, Hippius.

## Requirements

- Node.js 20 or newer
- A Hippius account
- A Hippius S3 bucket with a name unique to your account/use case
- Hippius S3 credentials from the Hippius console

Create credentials in the Hippius console under S3 Storage. The access key usually starts with `hip_`.

## Install

After the package is published to npm, MCP clients can run it with `npx`:

```bash
npx -y hippius-mcp
```

The server reads configuration from environment variables. For `npx` installs, configure those variables in your MCP client or shell:

```env
HIPPIUS_BUCKET_NAME=your-unique-bucket-name
HIPPIUS_ACCESS_KEY=hip_your_key
HIPPIUS_SECRET_KEY=your_secret
```

Optional:

```env
HIPPIUS_ENDPOINT=https://s3.hippius.com
HIPPIUS_REGION=decentralized
HIPPIUS_PREFIX=mcp/
```

Use your own bucket name. `your-unique-bucket-name` is only a placeholder.

## Install From Source

```bash
git clone https://github.com/poggle/hippius-mcp.git
cd hippius-mcp
npm install
npm run build
cp .env.example .env
```

Edit `.env`:

```env
HIPPIUS_BUCKET_NAME=your-unique-bucket-name
HIPPIUS_ACCESS_KEY=hip_your_key
HIPPIUS_SECRET_KEY=your_secret
```

Use your own bucket name. `your-unique-bucket-name` is only a placeholder.

Optional:

```env
HIPPIUS_ENDPOINT=https://s3.hippius.com
HIPPIUS_REGION=decentralized
HIPPIUS_PREFIX=mcp/
```

`HIPPIUS_PREFIX` is prepended to managed object keys. The default is `mcp/`.

## MCP Client Setup

The recommended setup uses `npx` so users do not need to clone or build this repository.

### Codex With npx

If your Hippius env vars are available in the shell that starts Codex, add the server and allow Codex to forward them:

```toml
[mcp_servers.hippius]
command = "npx"
args = ["-y", "hippius-mcp"]
env_vars = ["HIPPIUS_BUCKET_NAME", "HIPPIUS_ACCESS_KEY", "HIPPIUS_SECRET_KEY"]
```

You can add that block to `~/.codex/config.toml`.

Alternatively, add it with explicit env values:

```bash
codex mcp add hippius \
  --env HIPPIUS_BUCKET_NAME=your-unique-bucket-name \
  --env HIPPIUS_ACCESS_KEY=hip_your_key \
  --env HIPPIUS_SECRET_KEY=your_secret \
  -- npx -y hippius-mcp
```

Verify:

```bash
codex mcp get hippius
codex mcp list
```

In a Codex session, run `/mcp` to check that the server is active. You may need to start a new Codex session before newly added tools appear.

### Claude Code With npx

```bash
claude mcp add --scope user hippius \
  -e HIPPIUS_BUCKET_NAME=your-unique-bucket-name \
  -e HIPPIUS_ACCESS_KEY=hip_your_key \
  -e HIPPIUS_SECRET_KEY=your_secret \
  -- npx -y hippius-mcp
```

Verify:

```bash
claude mcp get hippius
claude mcp list
```

### Generic MCP JSON With npx

```json
{
  "mcpServers": {
    "hippius": {
      "command": "npx",
      "args": ["-y", "hippius-mcp"],
      "env": {
        "HIPPIUS_BUCKET_NAME": "your-unique-bucket-name",
        "HIPPIUS_ACCESS_KEY": "hip_...",
        "HIPPIUS_SECRET_KEY": "..."
      }
    }
  }
}
```

## Source Checkout MCP Setup

Use an absolute path to `dist/index.js`. If you keep credentials in this project's `.env`, launch the server from this directory.

### Codex From Source

```bash
codex mcp add hippius -- /bin/zsh -lc 'cd /absolute/path/to/hippius-mcp && exec node dist/index.js'
```

Verify:

```bash
codex mcp get hippius
codex mcp list
```

In a Codex session, run `/mcp` to check that the server is active. You may need to start a new Codex session before newly added tools appear.

### Claude Code From Source

```bash
claude mcp add --scope user hippius -- /bin/zsh -lc 'cd /absolute/path/to/hippius-mcp && exec node dist/index.js'
```

Verify:

```bash
claude mcp get hippius
claude mcp list
```

### Generic MCP JSON From Source

If your MCP client accepts JSON config, pass env vars directly:

```json
{
  "mcpServers": {
    "hippius": {
      "command": "node",
      "args": ["/absolute/path/to/hippius-mcp/dist/index.js"],
      "env": {
        "HIPPIUS_BUCKET_NAME": "your-unique-bucket-name",
        "HIPPIUS_ACCESS_KEY": "hip_...",
        "HIPPIUS_SECRET_KEY": "..."
      }
    }
  }
}
```

Or run from the project directory so `.env` is loaded:

```json
{
  "mcpServers": {
    "hippius": {
      "command": "/bin/zsh",
      "args": [
        "-lc",
        "cd /absolute/path/to/hippius-mcp && exec node dist/index.js"
      ]
    }
  }
}
```

## Tools

### `hippius_upload_file`

Upload a local file to Hippius S3.

Inputs:

- `path` string, required: local file path
- `mode` `"shareable"` or `"public"`, default: `"shareable"`
- `key` string, optional: object key
- `contentType` string, optional: MIME type override
- `expiresIn` number, optional: share link lifetime in seconds, max 604800

Example:

```json
{
  "path": "/Users/me/Desktop/report.pdf",
  "mode": "shareable",
  "expiresIn": 3600
}
```

### `hippius_upload_text`

Upload generated text content to Hippius S3.

Inputs:

- `name` string, required: filename used when `key` is omitted
- `content` string, required
- `mode` `"shareable"` or `"public"`, default: `"shareable"`
- `key` string, optional
- `contentType` string, default: `"text/plain"`
- `expiresIn` number, optional: share link lifetime in seconds, max 604800

Example:

```json
{
  "name": "notes.md",
  "content": "# Notes\n\nHello from MCP.",
  "mode": "public",
  "contentType": "text/markdown"
}
```

### `hippius_create_share_link`

Create a presigned share link for an existing object.

Inputs:

- `key` string, required
- `expiresIn` number, default: 3600, max 604800

Example:

```json
{
  "key": "mcp/shareable/2026-07-01/example.txt",
  "expiresIn": 86400
}
```

### `hippius_delete_file`

Delete an object by key or by stable Hippius object URL.

Inputs:

- `key` string, optional
- `url` string, optional

Provide exactly one of `key` or `url`.

Example:

```json
{
  "key": "mcp/public/2026-07-01/example.txt"
}
```

## Sharing Modes

`shareable` uploads are private objects. The tool returns a presigned URL that expires. The default expiry is 1 hour. Hippius supports presigned URLs up to 7 days.

`public` uploads use the object ACL `public-read`. The tool returns a stable anonymous URL. Public files stay public until you delete them or change their ACL outside this MCP.

Deletion works for both modes.

## Security

- Do not commit `.env`.
- Treat `HIPPIUS_ACCESS_KEY` and `HIPPIUS_SECRET_KEY` as secrets.
- Rotate credentials in the Hippius console if they are leaked.
- Prefer `shareable` mode unless you explicitly need a permanent public URL.
- Public URLs can be accessed by anyone who has the link.
- Presigned share links cannot be revoked individually without deleting the object, changing the object key, or rotating credentials.

## Development

```bash
npm install
npm run check
npm run build
npm run dev
```

Run the built server:

```bash
npm start
```

## Publishing

For a first GitHub release:

```bash
npm run build
git init
git add .
git commit -m "Initial Hippius MCP server"
git branch -M main
git remote add origin git@github.com:poggle/hippius-mcp.git
git push -u origin main
```

Before publishing to npm, confirm the final package name and repository URL, then run:

```bash
npm publish --access public
```

## License

MIT
