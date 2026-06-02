const B = '`';

const content = `# Platform Setup Guide
## DepShield : Complete Local + Production Setup

**Version:** 1.0
**Date:** May 2026

---

## 1. Prerequisites

${B}${B}${B}bash
# Verify these are installed
node --version     # 18+
bun --version      # 1.0+
docker --version   # 20+
git --version      # 2+
${B}${B}${B}

Install Bun if missing:
${B}${B}${B}bash
curl -fsSL https://bun.sh/install | bash
${B}${B}${B}

---

## 2. Clone & Install

${B}${B}${B}bash
git clone https://github.com/your-username/depshield
cd depshield
bun install
${B}${B}${B}

---

## 3. Docker Setup (Local Elasticsearch)

### 3.1 docker/docker-compose.yml

${B}${B}${B}yaml
version: '3.8'

services:
  elasticsearch:
    image: elasticsearch:8.13.0
    container_name: depshield-elastic
    environment:
      - discovery.type=single-node
      - xpack.security.enabled=false
      - xpack.license.self_generated.type=basic
      - ES_JAVA_OPTS=-Xms512m -Xmx512m
    ports:
      - "9200:9200"
      - "9300:9300"
    volumes:
      - es_data:/usr/share/elasticsearch/data
    healthcheck:
      test: ["CMD-SHELL", "curl -f http://localhost:9200 || exit 1"]
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  es_data:
    driver: local
${B}${B}${B}

### 3.2 Commands

${B}${B}${B}bash
# Start Elasticsearch
bun run docker:up
# OR directly:
docker-compose -f docker/docker-compose.yml up -d

# Verify running
curl http://localhost:9200
# Expected: {"name":"...","cluster_name":"docker-cluster",...}

# Check health
curl http://localhost:9200/_cluster/health

# Stop
bun run docker:down
# OR:
docker-compose -f docker/docker-compose.yml down

# Stop + delete all data (fresh start)
docker-compose -f docker/docker-compose.yml down -v

# View logs
docker logs depshield-elastic -f
${B}${B}${B}

### 3.3 Verify Elasticsearch

${B}${B}${B}bash
# Create test index
curl -X PUT http://localhost:9200/test-index

# Delete test index
curl -X DELETE http://localhost:9200/test-index

# List all indices
curl http://localhost:9200/_cat/indices?v
${B}${B}${B}

---

## 4. Cloudflare Wrangler Setup

### 4.1 Login

${B}${B}${B}bash
bunx wrangler login
# Opens browser - login with Cloudflare account
# Verify login:
bunx wrangler whoami
${B}${B}${B}

### 4.2 Create D1 Database

${B}${B}${B}bash
bunx wrangler d1 create depshield

# Output will look like:
# ✅ Successfully created DB 'depshield'
# [[d1_databases]]
# binding = "DB"
# database_name = "depshield"
# database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"

# Copy the database_id - add to wrangler.jsonc and .env.local
${B}${B}${B}

### 4.3 Create KV Namespace

${B}${B}${B}bash
bunx wrangler kv namespace create depshield-cache

# Output:
# ✅ Successfully created KV namespace
# id = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"

# Copy the id - add to wrangler.jsonc
${B}${B}${B}

### 4.4 Create Queues

${B}${B}${B}bash
# Scan queue
bunx wrangler queues create depshield-scan-queue

# Migration queue
bunx wrangler queues create depshield-migration-queue
${B}${B}${B}

### 4.5 wrangler.jsonc (Complete Config)

${B}${B}${B}json
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "depshield",
  "compatibility_date": "2024-09-23",
  "compatibility_flags": ["nodejs_compat"],

  // D1 Database
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "depshield",
      "database_id": "YOUR_D1_DATABASE_ID"
    }
  ],

  // KV Namespace
  "kv_namespaces": [
    {
      "binding": "KV",
      "id": "YOUR_KV_NAMESPACE_ID"
    }
  ],

  // Queues
  "queues": {
    "producers": [
      {
        "queue": "depshield-scan-queue",
        "binding": "SCAN_QUEUE"
      },
      {
        "queue": "depshield-migration-queue",
        "binding": "MIGRATION_QUEUE"
      }
    ],
    "consumers": [
      {
        "queue": "depshield-scan-queue",
        "max_batch_size": 1,
        "max_retries": 3,
        "dead_letter_queue": "depshield-scan-dlq"
      },
      {
        "queue": "depshield-migration-queue",
        "max_batch_size": 1,
        "max_retries": 3
      }
    ]
  },

  // OpenNext config
  "main": ".open-next/worker.js",
  "assets": {
    "directory": ".open-next/assets",
    "binding": "ASSETS"
  }
}
${B}${B}${B}

### 4.6 Set Wrangler Secrets

${B}${B}${B}bash
# These are encrypted secrets - never in code or .env committed to git

bunx wrangler secret put ENCRYPTION_KEY
# Paste your 32-char random string

bunx wrangler secret put NEXTAUTH_SECRET
# Paste your nextauth secret

bunx wrangler secret put GOOGLE_CLIENT_ID
bunx wrangler secret put GOOGLE_CLIENT_SECRET

bunx wrangler secret put ELASTIC_API_KEY
bunx wrangler secret put ELASTIC_URL
bunx wrangler secret put ELASTIC_MCP_ENDPOINT

bunx wrangler secret put GITHUB_TOKEN
bunx wrangler secret put GITLAB_TOKEN

bunx wrangler secret put GOOGLE_CLOUD_PROJECT_ID
bunx wrangler secret put VERTEX_AI_API_KEY
${B}${B}${B}

### 4.7 Verify Wrangler Setup

${B}${B}${B}bash
# List all D1 databases
bunx wrangler d1 list

# List all KV namespaces
bunx wrangler kv namespace list

# List all queues
bunx wrangler queues list

# Preview locally (uses remote D1/KV)
bun run preview
${B}${B}${B}

---

## 5. Database Setup (Drizzle + D1)

### 5.1 Install Drizzle

${B}${B}${B}bash
bun add drizzle-orm
bun add -d drizzle-kit
${B}${B}${B}

### 5.2 drizzle.config.ts

${B}${B}${B}typescript
import type { Config } from 'drizzle-kit'

export default {
  schema: './src/backend/db/schema.ts',
  out: './drizzle/migrations',
  dialect: 'sqlite',
  driver: 'd1-http',
  dbCredentials: {
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID!,
    databaseId: process.env.D1_DATABASE_ID!,
    token: process.env.CLOUDFLARE_API_TOKEN!,
  },
} satisfies Config
${B}${B}${B}

### 5.3 Generate & Apply Migrations

${B}${B}${B}bash
# Generate migration files from schema
bunx drizzle-kit generate

# Apply to LOCAL D1 (development)
bunx wrangler d1 execute depshield \
  --local \
  --file=./drizzle/migrations/0000_init.sql

# Apply to REMOTE D1 (production)
bunx wrangler d1 execute depshield \
  --file=./drizzle/migrations/0000_init.sql
${B}${B}${B}

### 5.4 Inspect Local D1

${B}${B}${B}bash
# Open D1 studio (browser UI)
bunx wrangler d1 studio depshield

# Or direct query
bunx wrangler d1 execute depshield \
  --local \
  --command="SELECT * FROM users LIMIT 10"
${B}${B}${B}

---

## 6. Environment Variables

### 6.1 .env.example (commit this)

${B}${B}${B}env
# ── Google OAuth ──────────────────────────────────────────────
# Get from: console.cloud.google.com → APIs & Services → Credentials
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
# Generate: openssl rand -base64 32
NEXTAUTH_SECRET=
NEXTAUTH_URL=http://localhost:3000

# ── Elastic ───────────────────────────────────────────────────
# Local Docker:
ELASTIC_URL=http://localhost:9200
ELASTIC_API_KEY=
# Production (Elastic Cloud Serverless):
# ELASTIC_URL=https://your-project.es.us-central1.gcp.elastic.cloud
# ELASTIC_API_KEY=your-api-key
ELASTIC_MCP_ENDPOINT=

# ── GitLab ────────────────────────────────────────────────────
# Get from: gitlab.com → User Settings → Access Tokens
# Scopes: api, read_repository, write_repository
GITLAB_TOKEN=
GITLAB_URL=https://gitlab.com
GITLAB_TEST_REPO=your-username/dep-migration-test

# ── GitHub ────────────────────────────────────────────────────
# Get from: github.com → Settings → Developer Settings → PAT
# Scopes: public_repo, read:user
GITHUB_TOKEN=

# ── Encryption ────────────────────────────────────────────────
# Generate: openssl rand -base64 32
ENCRYPTION_KEY=

# ── Google Cloud ──────────────────────────────────────────────
GOOGLE_CLOUD_PROJECT_ID=
GOOGLE_CLOUD_LOCATION=us-central1
VERTEX_AI_API_KEY=

# ── Cloudflare ────────────────────────────────────────────────
# Get from: dash.cloudflare.com → My Profile → API Tokens
CLOUDFLARE_ACCOUNT_ID=
CLOUDFLARE_API_TOKEN=
D1_DATABASE_ID=
KV_NAMESPACE_ID=
${B}${B}${B}

### 6.2 .env.local (never commit - in .gitignore)

Copy ${B}.env.example${B} to ${B}.env.local${B} and fill all values.

---

## 7. package.json Scripts

${B}${B}${B}json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "format": "prettier . --write",
    "deploy": "opennextjs-cloudflare build && opennextjs-cloudflare deploy",
    "upload": "opennextjs-cloudflare build && opennextjs-cloudflare upload",
    "preview": "opennextjs-cloudflare build && opennextjs-cloudflare preview",
    "cf-typegen": "wrangler types --env-interface CloudflareEnv ./cloudflare-env.d.ts",
    "docker:up": "docker-compose -f docker/docker-compose.yml up -d",
    "docker:down": "docker-compose -f docker/docker-compose.yml down",
    "docker:logs": "docker logs depshield-elastic -f",
    "docker:fresh": "docker-compose -f docker/docker-compose.yml down -v && docker-compose -f docker/docker-compose.yml up -d",
    "db:generate": "drizzle-kit generate",
    "db:migrate:local": "wrangler d1 execute depshield --local --file=./drizzle/migrations/0000_init.sql",
    "db:migrate:remote": "wrangler d1 execute depshield --file=./drizzle/migrations/0000_init.sql",
    "db:studio": "wrangler d1 studio depshield",
    "seed:elastic": "bun run scripts/seed-elastic.ts",
    "prepare": "husky"
  }
}
${B}${B}${B}

---

## 8. cloudflare-env.d.ts (Complete)

${B}${B}${B}typescript
interface CloudflareEnv {
  // ── Cloudflare Services ──────────────────────────────────
  DB: D1Database
  KV: KVNamespace
  ASSETS: Fetcher
  SCAN_QUEUE: Queue
  MIGRATION_QUEUE: Queue

  // ── Auth ─────────────────────────────────────────────────
  NEXTAUTH_SECRET: string
  NEXTAUTH_URL: string
  GOOGLE_CLIENT_ID: string
  GOOGLE_CLIENT_SECRET: string

  // ── Elastic ──────────────────────────────────────────────
  ELASTIC_URL: string
  ELASTIC_API_KEY: string
  ELASTIC_MCP_ENDPOINT: string

  // ── GitLab ───────────────────────────────────────────────
  GITLAB_TOKEN: string
  GITLAB_URL: string

  // ── GitHub ───────────────────────────────────────────────
  GITHUB_TOKEN: string

  // ── Encryption ───────────────────────────────────────────
  ENCRYPTION_KEY: string

  // ── Google Cloud ─────────────────────────────────────────
  GOOGLE_CLOUD_PROJECT_ID: string
  GOOGLE_CLOUD_LOCATION: string
  VERTEX_AI_API_KEY: string
}
${B}${B}${B}

---

## 9. Verify Complete Setup

Run this checklist before starting development:

${B}${B}${B}bash
# 1. Elasticsearch running
curl http://localhost:9200
# ✅ Returns cluster info

# 2. Wrangler authenticated
bunx wrangler whoami
# ✅ Returns your Cloudflare email

# 3. D1 accessible
bunx wrangler d1 list
# ✅ Shows depshield database

# 4. Dependencies installed
bun install
# ✅ No errors

# 5. Dev server starts
bun run dev
# ✅ Opens on localhost:3000

# 6. .env.local filled
cat .env.local | grep -v "^#" | grep "=$"
# ✅ No empty required values
${B}${B}${B}

---

## 10. Common Issues

| Issue | Fix |
|---|---|
| ${B}docker: command not found${B} | Install Docker Desktop |
| Elasticsearch ${B}137${B} exit code | Increase Docker memory to 4GB in Docker Desktop settings |
| ${B}wrangler: command not found${B} | ${B}bun add -g wrangler${B} |
| D1 ${B}database not found${B} | Check database_id in wrangler.jsonc matches ${B}wrangler d1 list${B} |
| ${B}NEXTAUTH_SECRET missing${B} | Run ${B}openssl rand base64 32${B} and add to .env.local |
| Elastic ${B}connection refused${B} | Run ${B}bun run docker:up${B} and wait 30 seconds |
| ${B}Cannot find module${B} | Run ${B}bun install${B} |`;

export default content;
