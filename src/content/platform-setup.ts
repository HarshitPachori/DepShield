const B = '`';

const content = `# Local Development Setup
## DepShield

**Prerequisites:** Node.js 18+, Bun, Docker Desktop, Git

---

## 1. Clone Repository

${B}${B}${B}bash
git clone https://github.com/your-username/depshield
cd depshield
bun install
${B}${B}${B}

---

## 2. Environment Variables

${B}${B}${B}bash
cp .env.example .env.local
${B}${B}${B}

Fill in '.env.local':

${B}${B}${B}env
# Google OAuth (console.cloud.google.com → Credentials)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
NEXTAUTH_SECRET=     # random 32 char string: openssl rand -base64 32
NEXTAUTH_URL=http://localhost:3000

# Elastic (local Docker)
ELASTIC_URL=http://localhost:9200
ELASTIC_API_KEY=     # leave empty for local

# MongoDB (optional)
MONGODB_URI=

# GitLab PAT (gitlab.com → Settings → Access Tokens)
GITLAB_TOKEN=
GITLAB_URL=https://gitlab.com

# GitHub PAT (github.com → Settings → Developer Settings)
GITHUB_TOKEN=

# Encryption (random 32 char string)
ENCRYPTION_KEY=

# Cloudflare (after wrangler setup)
CLOUDFLARE_ACCOUNT_ID=
CLOUDFLARE_API_TOKEN=
D1_DATABASE_ID=
KV_NAMESPACE_ID=
${B}${B}${B}

---

## 3. Start Elasticsearch Locally

${B}${B}${B}bash
bun run docker:up
# Verify
curl http://localhost:9200
# Should return cluster info JSON
${B}${B}${B}

---

## 4. Cloudflare Services Setup

${B}${B}${B}bash
# Login
bunx wrangler login

# Create D1 database
bunx wrangler d1 create depshield
# Copy database_id to wrangler.jsonc and .env.local

# Create KV namespace
bunx wrangler kv:namespace create depshield-cache
# Copy id to wrangler.jsonc

# Create Queue
bunx wrangler queues create depshield-scan-queue
bunx wrangler queues create depshield-migration-queue
${B}${B}${B}

---

## 5. Database Migrations

${B}${B}${B}bash
# Generate migrations from schema
bunx drizzle-kit generate

# Apply to local D1
bunx wrangler d1 execute depshield --local --file=./drizzle/migrations/0000_init.sql
${B}${B}${B}

---

## 6. Seed Elasticsearch

${B}${B}${B}bash
# Seed with deprecated package data
bun run scripts/seed-elastic.ts
${B}${B}${B}

---

## 7. Start Development Server

${B}${B}${B}bash
bun run dev
# Open http://localhost:3000
${B}${B}${B}

---

## 8. Test the Agent

1. Open http://localhost:3000
2. Paste: 'https://gitlab.com/your-username/dep-migration-test'
3. Click "Scan Now"
4. Verify 3 packages flagged as high risk
5. Click "request" → verify CRITICAL score
6. Click "Simulate Migration" → verify affected files shown
7. Click "Migrate Now" → add GitLab token → verify MR created

---

## 9. Deploy to Cloudflare

${B}${B}${B}bash
bun run deploy
# Builds with OpenNext + deploys to Cloudflare Workers + Pages
${B}${B}${B}`;

export default content;
