const B = '`';

const content = `# High Level Design (HLD)
## DepShield : AI-Powered Dependency Intelligence Agent

**Version:** 1.0  
**Date:** May 2026

---

## 1. System Overview

DepShield is a cloud-native AI agent application deployed on Cloudflare's edge network. It orchestrates multiple external services - Elastic MCP for intelligence, GitLab/GitHub APIs for actions, and Google Cloud Agent Builder + Gemini for reasoning, to deliver automated dependency risk detection and migration.

---

## 2. Architecture Diagram

${B}${B}${B}
┌─────────────────────────────────────────────────────────────────┐
│                         USER BROWSER                            │
│                    depshield.pages.dev                          │
│                                                                 │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────┐        │
│  │  Landing    │  │    Risk      │  │   Migration      │        │
│  │  Page       │  │  Dashboard   │  │   Status         │        │
│  └─────────────┘  └──────────────┘  └──────────────────┘        │
└──────────────────────────┬──────────────────────────────────────┘
                           │ HTTPS
┌─────────────────────────▼──────────────────────────────────────┐
│                  CLOUDFLARE PAGES + WORKERS                     │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │              Next.js App (OpenNext)                     │    │
│  │  ┌──────────────────┐   ┌─────────────────────────┐     │    │
│  │  │   App Router     │   │    Hono API Layer       │     │    │
│  │  │   (Frontend)     │   │    /api/[[...route]]      │     │    │
│  │  └──────────────────┘   └────────────┬────────────┘     │    │
│  └──────────────────────────────────────┼──────────────────┘    │
│                                         │                       │
│  ┌─────────────────────────────────────▼──────────────────┐    │
│  │                  Cloudflare Services                    │    │
│  │                                                         │    │
│  │   ┌──────────┐  ┌──────────┐  ┌────────────────────┐    │    │
│  │   │    D1    │  │    KV    │  │      Queues        │    │    │
│  │   │ SQLite   │  │  Cache   │  │  (Scan Jobs)       │    │    │
│  │   │  Users   │  │  Jobs    │  │  (Migration Jobs)  │    │    │
│  │   │  Jobs    │  │  Status  │  │                    │    │    │
│  │   │  Tokens  │  │          │  │                    │    │    │
│  │   └──────────┘  └──────────┘  └────────────────────┘    │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
               │                    │                    │
     ┌─────────▼──────┐   ┌────────▼───────┐   ┌──────▼───────┐
     │  ELASTIC CLOUD  │   │  GOOGLE CLOUD   │   │    GITLAB /    │
     │  (Serverless)   │   │  AGENT BUILDER  │   │    GITHUB      │
     │                 │   │  + Gemini       │   │                │
     │  Agent Builder  │   │                 │   │  MCP Server    │
     │  MCP Server     │   │  Reasoning      │   │  REST API      │
     │                 │   │  Planning       │   │                │
     │  Package data   │   │  Code transform │   │  Branch/MR/PR  │
     │  CVE signals    │   │                 │   │  CI/CD         │
     │  Community disc │   │                 │   │                │
     └─────────────────┘   └─────────────────┘   └────────────────┘
               │
     ┌─────────▼──────────────────────────────┐
     │           EXTERNAL DATA SOURCES         │
     │                                         │
     │  npm Registry API  - package metadata   │
     │  GitHub API        - commit activity    │
     │  OSV.dev API       - CVE database       │
     │  PyPI API          - Python packages    │
     │  pkg.go.dev        - Go packages        │
     └─────────────────────────────────────────┘
${B}${B}${B}

---

## 3. Component Descriptions

### 3.1 Frontend - Next.js on Cloudflare Pages

**Technology:** Next.js 16 + Tailwind CSS + shadcn/ui  
**Hosting:** Cloudflare Pages  
**URL:** depshield.pages.dev

Responsibilities:
- Render all user-facing pages
- Poll scan/migration status APIs
- Display real-time agent logs
- Persist scan history in localStorage
- Handle Google OAuth via NextAuth.js

---

### 3.2 API Layer - Hono on Cloudflare Workers

**Technology:** Hono + TypeScript  
**Hosting:** Cloudflare Workers (via OpenNext)  
**URL:** Same origin via '/api/*'

Responsibilities:
- Accept and validate all API requests
- Create scan/migration jobs in D1
- Push jobs to Cloudflare Queues
- Return job status from KV
- Orchestrate calls to external services

Routes:
${B}${B}${B}
POST   /api/scan
GET    /api/status/:jobId
POST   /api/simulate
POST   /api/migrate
GET    /api/migrate/:migrationId
POST   /api/tokens
DELETE /api/tokens/:id
GET    /api/auth/[...nextauth]
${B}${B}${B}

---

### 3.3 Queue Consumer Workers

**Technology:** Cloudflare Workers (separate from API worker)

Two consumers:

**Scan Consumer:**
- Reads repo dependencies
- Calls npm/GitHub/OSV APIs per package
- Searches Elastic via MCP
- Calculates risk scores
- Stores results in D1 + KV

**Migration Consumer:**
- Calls Google Cloud Agent Builder
- Gemini transforms code files
- GitLab MCP / GitHub API creates branch + commits + MR/PR
- Stores migration result in D1

---

### 3.4 Elastic Cloud (Primary MCP Partner)

**Technology:** Elastic Cloud Serverless + Agent Builder  
**Role:** Intelligence layer - semantic search over package signals

What is indexed:
- Package deprecation notices
- CVE descriptions and affected versions
- Community migration discussions (Stack Overflow, Reddit, GitHub issues)
- npm/PyPI/pkg.go.dev package metadata
- Alternative package recommendations

How it is used:
- Agent queries Elastic MCP: *"Find migration guides from request to alternatives"*
- Elastic returns ranked semantic results
- Gemini reasons over results to produce risk explanation and migration plan

---

### 3.5 Google Cloud Agent Builder + Gemini

**Technology:** Vertex AI Agent Builder + Gemini 2.0  
**Role:** Brain - multi-step reasoning, code transformation

Used for:
- Reasoning over Elastic search results to produce risk scores
- Planning migration steps
- Transforming code files (callbacks → async/await, API shape changes)
- Generating MR/PR descriptions

---

### 3.6 GitLab MCP / GitHub REST API

**Technology:** GitLab MCP Server + GitHub REST API  
**Role:** Action layer - takes real actions on user repos

GitLab MCP tools used:
- 'get_file' - read dependency files
- 'list_files' - detect ecosystem
- 'search_code' - find usages of at-risk packages
- 'create_branch' - create migration branch
- 'commit_files' - commit transformed code
- 'trigger_pipeline' - run CI
- 'create_merge_request' - open MR

GitHub REST API (no MCP):
- Read files from public repos
- Create branches, commits, PRs

---

### 3.7 Cloudflare D1

**Technology:** SQLite on Cloudflare (D1)  
**ORM:** Drizzle

Stores:
- Users (Google OAuth profiles)
- PAT tokens (AES-256-GCM encrypted)
- Scan jobs + results
- Migration jobs + results

---

### 3.8 Cloudflare KV

**Purpose:** Fast real-time job status for polling

Stores:
- Scan job progress (TTL: 24 hours)
- Migration job progress (TTL: 24 hours)

Why KV and not D1: KV reads are ~1ms globally. D1 reads are ~5-10ms. For polling every 2 seconds, KV is significantly faster.

---

## 4. Data Flow Diagrams

### 4.1 Scan Flow

${B}${B}${B}
User submits repo URL
        │
POST /api/scan (Hono)
        │
Create scan job in D1
Push to SCAN_QUEUE
Return jobId (< 200ms)
        │
Frontend polls /api/status/:jobId every 2s
        │
Queue Consumer starts:
        │
        ├─► Fetch repo file list (GitHub/GitLab API)
        │   Detect ecosystem + package manager
        │
        ├─► Parse dependency file (package.json etc.)
        │   Extract package names
        │
        ├─► For each package (batches of 10):
        │   ├─► npm Registry API → metadata
        │   ├─► OSV.dev API → CVEs
        │   └─► GitHub API → commit activity
        │
        ├─► Elastic MCP search:
        │   "package health signals {name}"
        │   Returns: community sentiment, alternatives
        │
        ├─► Gemini reasoning:
        │   Combine signals → risk score + explanation
        │
        ├─► Update KV with progress
        │
        └─► Store final results in D1 + KV
            Update job status: complete
${B}${B}${B}

### 4.2 Migration Flow

${B}${B}${B}
User confirms migration
        │
POST /api/migrate (Hono)
Create migration job in D1
Push to MIGRATION_QUEUE
Return migrationId
        │
Frontend polls /api/migrate/:id every 2s
        │
Queue Consumer starts:
        │
        ├─► Elastic MCP: search migration patterns
        │   "migrating from {package} to {alternative}"
        │
        ├─► GitLab MCP: search_code
        │   Find all usages of package in repo
        │
        ├─► Gemini: analyze each affected file
        │   Generate transformed version
        │
        ├─► GitLab MCP: create_branch
        │   "depshield/migrate-{package}-to-{alternative}"
        │
        ├─► GitLab MCP: commit_files
        │   All transformed files
        │
        ├─► GitLab MCP: trigger_pipeline
        │   Wait for CI result
        │
        ├─► GitLab MCP: create_merge_request
        │   Title + full description + test results
        │
        └─► Update D1 + KV with MR URL + status
${B}${B}${B}

---

## 5. Technology Stack Summary

| Layer | Technology | Hosting |
|---|---|---|
| Frontend | Next.js 16 + Tailwind + shadcn | Cloudflare Pages |
| API | Hono + TypeScript | Cloudflare Workers |
| Queue Processing | Cloudflare Workers | Cloudflare |
| Primary DB | Cloudflare D1 (SQLite) + Drizzle ORM | Cloudflare |
| Cache/Status | Cloudflare KV | Cloudflare |
| Job Queue | Cloudflare Queues | Cloudflare |
| Intelligence | Elastic Cloud Serverless + Agent Builder | GCP us-central1 |
| AI Reasoning | Google Cloud Agent Builder + Gemini 2.0 | Google Cloud |
| Actions (GitLab) | GitLab MCP Server | GitLab.com |
| Actions (GitHub) | GitHub REST API | GitHub.com |
| Auth | NextAuth.js + Google OAuth | Cloudflare |
| Package Data | npm Registry + GitHub + OSV.dev APIs | Public |
| Local Dev (Elastic) | Docker + Elasticsearch 8.13 | Local |

---

## 6. Security Architecture

${B}${B}${B}
PAT Token Storage:
User token → AES-256-GCM encrypt → D1 store
                                        │
Request needs token → D1 fetch → decrypt in Worker memory
                                        │
Token used for API call → never logged → memory cleared
${B}${B}${B}

Token never:
- Logged to console
- Stored in KV (only D1 encrypted)
- Sent to frontend
- Included in error messages

---

## 7. Deployment Architecture

${B}${B}${B}
GitHub repo (main branch)
        │
Cloudflare Workers CI/CD (via OpenNext.js Cloudflare adapter)
        │
     Workers
(Next.js) + (Hono + Queue Consumers)
        │
    depshield.workers.dev
${B}${B}${B}

Both deployed from same repo via:
${B}${B}${B}bash
bun run deploy
# opennextjs-cloudflare build && opennextjs-cloudflare deploy
${B}${B}${B}`;

export default content;
