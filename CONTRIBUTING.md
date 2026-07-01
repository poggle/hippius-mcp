# Contributing

Thanks for improving Hippius MCP.

## Development

```bash
npm install
npm run check
npm run build
```

Keep changes small and focused. Include README updates when changing tool names, inputs, environment variables, or sharing behavior.

## Design Principles

- Default to private/shareable uploads.
- Require explicit intent for public uploads.
- Keep credentials in environment variables or `.env`, never tool arguments.
- Keep the MCP local-first so it can read local file paths.
- Preserve compatibility with standard S3 behavior where possible.

## Pull Requests

Before opening a PR:

```bash
npm run check
npm run build
```

If your change touches upload, sharing, or deletion behavior, include a short manual test note in the PR description.
