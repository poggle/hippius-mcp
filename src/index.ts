#!/usr/bin/env node

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import type { Readable } from "node:stream";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const MAX_PRESIGN_SECONDS = 7 * 24 * 60 * 60;
const DEFAULT_PRESIGN_SECONDS = 60 * 60;

type UploadMode = "shareable" | "public";

type JsonValue = Record<string, unknown>;

function requireEnv(primary: string, aliases: string[] = []): string {
  for (const name of [primary, ...aliases]) {
    const value = process.env[name];
    if (value && value.trim()) {
      return value.trim();
    }
  }

  throw new Error(`Missing required environment variable: ${primary}`);
}

function optionalEnv(primary: string, fallback: string): string {
  const value = process.env[primary];
  return value && value.trim() ? value.trim() : fallback;
}

const config = {
  endpoint: optionalEnv("HIPPIUS_ENDPOINT", "https://s3.hippius.com").replace(/\/+$/, ""),
  region: optionalEnv("HIPPIUS_REGION", "decentralized"),
  bucket: requireEnv("HIPPIUS_BUCKET_NAME", ["HIPPIUS_BUCKET"]),
  accessKeyId: requireEnv("HIPPIUS_ACCESS_KEY", ["HIPPIUS_ACCESS_KEY_ID", "HIPPIUS_MASTER_KEY_ID"]),
  secretAccessKey: requireEnv("HIPPIUS_SECRET_KEY", ["HIPPIUS_SECRET_ACCESS_KEY", "HIPPIUS_MASTER_SECRET_KEY"]),
  prefix: normalizePrefix(optionalEnv("HIPPIUS_PREFIX", "mcp/")),
};

const s3 = new S3Client({
  endpoint: config.endpoint,
  region: config.region,
  forcePathStyle: true,
  credentials: {
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
  },
});

function normalizePrefix(prefix: string): string {
  const clean = prefix.replace(/^\/+|\/+$/g, "");
  return clean ? `${clean}/` : "";
}

function normalizeKey(input: string): string {
  const clean = input.replace(/^\/+/, "");
  if (!clean || clean.includes("..")) {
    throw new Error("Invalid object key");
  }
  return clean;
}

function withManagedPrefix(input: string): string {
  const clean = normalizeKey(input);
  if (!config.prefix || clean.startsWith(config.prefix)) {
    return clean;
  }
  return `${config.prefix}${clean}`;
}

function createDefaultKey(mode: UploadMode, name: string): string {
  const safeName = path.basename(name).replace(/[^a-zA-Z0-9._-]+/g, "-") || "upload";
  const date = new Date().toISOString().slice(0, 10);
  const id = crypto.randomBytes(6).toString("hex");
  return withManagedPrefix(`${mode}/${date}/${id}-${safeName}`);
}

function encodeObjectKey(key: string): string {
  return key.split("/").map(encodeURIComponent).join("/");
}

function objectUrl(bucket: string, key: string): string {
  return `${config.endpoint}/${encodeURIComponent(bucket)}/${encodeObjectKey(key)}`;
}

function clampExpiry(expiresIn?: number): number {
  if (expiresIn === undefined) {
    return DEFAULT_PRESIGN_SECONDS;
  }
  if (!Number.isInteger(expiresIn) || expiresIn < 1 || expiresIn > MAX_PRESIGN_SECONDS) {
    throw new Error(`expiresIn must be an integer from 1 to ${MAX_PRESIGN_SECONDS} seconds`);
  }
  return expiresIn;
}

function inferContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const byExt: Record<string, string> = {
    ".css": "text/css",
    ".csv": "text/csv",
    ".gif": "image/gif",
    ".htm": "text/html",
    ".html": "text/html",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".js": "text/javascript",
    ".json": "application/json",
    ".md": "text/markdown",
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".txt": "text/plain",
    ".webp": "image/webp",
    ".xml": "application/xml",
    ".zip": "application/zip",
  };
  return byExt[ext] ?? "application/octet-stream";
}

function jsonContent(value: JsonValue) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}

async function presignGetUrl(key: string, expiresIn?: number): Promise<{ url: string; expiresIn: number; expiresAt: string }> {
  const seconds = clampExpiry(expiresIn);
  const command = new GetObjectCommand({
    Bucket: config.bucket,
    Key: key,
  });
  const url = await getSignedUrl(s3, command, { expiresIn: seconds });
  return {
    url,
    expiresIn: seconds,
    expiresAt: new Date(Date.now() + seconds * 1000).toISOString(),
  };
}

async function uploadObject(params: {
  body: Buffer | Readable;
  key: string;
  contentType: string;
  mode: UploadMode;
  expiresIn?: number;
}) {
  await s3.send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: params.key,
      Body: params.body,
      ContentType: params.contentType,
      ACL: params.mode === "public" ? "public-read" : "private",
    }),
  );

  if (params.mode === "public") {
    return {
      url: objectUrl(config.bucket, params.key),
      publicUrl: objectUrl(config.bucket, params.key),
    };
  }

  const share = await presignGetUrl(params.key, params.expiresIn);
  return {
    url: share.url,
    shareUrl: share.url,
    expiresIn: share.expiresIn,
    expiresAt: share.expiresAt,
  };
}

function keyFromUrl(urlString: string): string {
  const url = new URL(urlString);
  const expectedHost = new URL(config.endpoint).host;
  if (url.host !== expectedHost) {
    throw new Error(`URL host must match ${expectedHost}`);
  }

  const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  const [bucket, ...keyParts] = parts;
  if (bucket !== config.bucket) {
    throw new Error(`URL bucket must match configured bucket ${config.bucket}`);
  }
  if (!keyParts.length) {
    throw new Error("URL does not contain an object key");
  }
  return normalizeKey(keyParts.join("/"));
}

const uploadModeSchema = z.enum(["shareable", "public"]).default("shareable");

const server = new McpServer({
  name: "hippius-mcp",
  version: "0.1.0",
});

server.tool(
  "hippius_upload_file",
  "Upload a local file to Hippius S3 as a private share link or a public object.",
  {
    path: z.string().min(1).describe("Local filesystem path to upload."),
    mode: uploadModeSchema.describe("shareable returns a presigned URL; public returns a stable public URL."),
    key: z.string().min(1).optional().describe("Optional object key. HIPPIUS_PREFIX is prepended when omitted from the key."),
    contentType: z.string().min(1).optional().describe("Optional MIME type override."),
    expiresIn: z.number().int().min(1).max(MAX_PRESIGN_SECONDS).optional().describe("Reserved for share links, in seconds. Max 7 days."),
  },
  async (args) => {
    const filePath = path.resolve(args.path);
    const info = await stat(filePath);
    if (!info.isFile()) {
      throw new Error(`${filePath} is not a file`);
    }

    const mode = args.mode;
    const key = args.key ? withManagedPrefix(args.key) : createDefaultKey(mode, filePath);
    const contentType = args.contentType ?? inferContentType(filePath);

    await s3.send(
      new PutObjectCommand({
        Bucket: config.bucket,
        Key: key,
        Body: createReadStream(filePath),
        ContentLength: info.size,
        ContentType: contentType,
        ACL: mode === "public" ? "public-read" : "private",
      }),
    );

    const link =
      mode === "public"
        ? { url: objectUrl(config.bucket, key), publicUrl: objectUrl(config.bucket, key) }
        : await presignGetUrl(key, args.expiresIn);

    return jsonContent({
      bucket: config.bucket,
      key,
      mode,
      contentType,
      size: info.size,
      ...link,
    });
  },
);

server.tool(
  "hippius_upload_text",
  "Upload text content to Hippius S3 as a private share link or a public object.",
  {
    name: z.string().min(1).describe("Filename or object name to use when key is not provided."),
    content: z.string().describe("Text content to upload."),
    mode: uploadModeSchema.describe("shareable returns a presigned URL; public returns a stable public URL."),
    key: z.string().min(1).optional().describe("Optional object key. HIPPIUS_PREFIX is prepended when omitted from the key."),
    contentType: z.string().min(1).default("text/plain").describe("MIME type for the uploaded text."),
    expiresIn: z.number().int().min(1).max(MAX_PRESIGN_SECONDS).optional().describe("Reserved for share links, in seconds. Max 7 days."),
  },
  async (args) => {
    const mode = args.mode;
    const key = args.key ? withManagedPrefix(args.key) : createDefaultKey(mode, args.name);
    const body = Buffer.from(args.content, "utf8");
    const link = await uploadObject({
      body,
      key,
      contentType: args.contentType,
      mode,
      expiresIn: args.expiresIn,
    });

    return jsonContent({
      bucket: config.bucket,
      key,
      mode,
      contentType: args.contentType,
      size: body.byteLength,
      ...link,
    });
  },
);

server.tool(
  "hippius_create_share_link",
  "Create a presigned share link for an existing private or public Hippius S3 object.",
  {
    key: z.string().min(1).describe("Object key. HIPPIUS_PREFIX is prepended when omitted from the key."),
    expiresIn: z.number().int().min(1).max(MAX_PRESIGN_SECONDS).default(DEFAULT_PRESIGN_SECONDS).describe("Share link lifetime in seconds. Max 7 days."),
  },
  async (args) => {
    const key = withManagedPrefix(args.key);
    const share = await presignGetUrl(key, args.expiresIn);
    return jsonContent({
      bucket: config.bucket,
      key,
      mode: "shareable",
      ...share,
    });
  },
);

server.tool(
  "hippius_delete_file",
  "Delete a Hippius S3 object by managed key or by stable Hippius object URL.",
  {
    key: z.string().min(1).optional().describe("Object key. HIPPIUS_PREFIX is prepended when omitted from the key."),
    url: z.string().url().optional().describe("Stable Hippius object URL to delete."),
  },
  async (args) => {
    if (!args.key && !args.url) {
      throw new Error("Provide key or url");
    }
    if (args.key && args.url) {
      throw new Error("Provide only one of key or url");
    }

    const key = args.url ? keyFromUrl(args.url) : withManagedPrefix(args.key!);
    await s3.send(
      new DeleteObjectCommand({
        Bucket: config.bucket,
        Key: key,
      }),
    );

    return jsonContent({
      bucket: config.bucket,
      key,
      deleted: true,
    });
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`hippius-mcp failed: ${message}`);
  process.exit(1);
});
