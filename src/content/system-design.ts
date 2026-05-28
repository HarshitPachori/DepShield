const B = '`';

const content = `# System Design

---

## DepShield : Infrastructure, Security & Scaling

**Version:** 1.0  
**Date:** May 2026

---

## 1. Infrastructure Overview

${B}${B}${B}
Cloudflare Edge Network (300+ PoPs globally)
├── Pages          → Next.js frontend (SSR + static)
├── Workers        → Hono API + Queue Consumers
├── D1             → SQLite database (users, jobs, tokens)
├── KV             → Key-value cache (job status, progress)
└── Queues         → Async job processing (scan, migrate)

Google Cloud (us-central1)
├── Agent Builder  → Multi-step agent orchestration
└── Gemini 2.0     → Reasoning + code transformation

Elastic Cloud (GCP us-central1)
├── Serverless ES  → Package signal index
└── Agent Builder  → MCP server + semantic search tools

External APIs (Public, Free)
├── npm Registry   → registry.npmjs.org
├── OSV.dev        → api.osv.dev
└── GitHub API     → api.github.com
${B}${B}${B}

---

## 2. Request Flow - Latency Budget

${B}${B}${B}
User clicks "Scan Now"
        │
POST /api/scan          ~100ms    ← Job created, jobId returned
        │
Queue Consumer starts   ~500ms    ← Queue pickup latency
        │
Ecosystem detection     ~300ms    ← GitHub API file list
        │
Parse dependencies      ~100ms    ← In-memory parsing
        │
150 packages × 3 APIs  ~8,000ms  ← Batches of 10, parallel
        │
Elastic MCP search      ~500ms    ← Per package, batched
        │
Gemini reasoning        ~2,000ms  ← Risk explanations
        │
Store results           ~200ms    ← D1 + KV write
        │
Total scan time:        ~12s      ← Under 15s target ✅
${B}${B}${B}

---

## 3. Rate Limiting Strategy

${B}${B}${B}
npm Registry API:     No auth = 100 req/min (no issue)
GitHub API:           Token = 5,000 req/hr  (batches of 10, ~500ms delay)
OSV.dev API:          No limit documented   (batch endpoint available)
Elastic MCP:          Depends on tier       (cache results per package)
Google Cloud:         Depends on quota      (1 reasoning call per package)
${B}${B}${B}

**Mitigation:**
- Batch processing: 10 packages simultaneously
- 500ms delay between batches
- Cache Elastic results in KV (TTL: 1 hour per package)
- Cache OSV results in KV (TTL: 6 hours per package)

---

## 4. Security Design

### 4.1 PAT Token Security

${B}${B}${B}
Storage:
  User provides token → Worker encrypts (AES-256-GCM)
  Encrypted blob stored in D1
  Encryption key stored in Cloudflare Worker Secret (not in code)

Retrieval:
  Worker fetches encrypted blob from D1
  Decrypts in Worker memory
  Uses for API call
  Clears from memory after use

Never:
  - Logged to console
  - Sent to browser
  - Stored in KV (only D1)
  - Included in error messages
  - Sent to Elastic or Google Cloud
${B}${B}${B}

### 4.2 Auth Flow

${B}${B}${B}
NextAuth.js handles Google OAuth
Session stored as JWT (httpOnly cookie)
userId extracted from session on each request
All D1 queries scoped to userId
${B}${B}${B}

### 4.3 Input Validation

All API inputs validated with Zod schemas before processing.
SQL injection not possible - Drizzle ORM uses parameterized queries.
XSS prevented - Next.js escapes all rendered content.

---

## 5. Error Handling Strategy

${B}${B}${B} typescript
// src/backend/util/response.ts
export const successResponse = <T>(c: Context, data: T, status = 200) =>
  c.json({ success: true, data }, status)

export const errorResponse = (c: Context, message: string, status = 400) =>
  c.json({ success: false, error: message }, status)

// All service calls wrapped in try/catch
// Queue consumer retries failed jobs 3 times
// After 3 failures: job marked error, user notified
${B}${B}${B}

---

## 6. Caching Strategy

${B}${B}${B}
Package risk data:
  KV cache key: "pkg:{ecosystem}:{name}:{version}"
  TTL: 6 hours
  Reason: Package signals don't change hourly

Job status:
  KV cache key: "job:{jobId}"
  TTL: 24 hours
  Reason: User may return same day

Elastic search results:
  KV cache key: "elastic:{hash(query)}"
  TTL: 1 hour
  Reason: Community signals change slowly
${B}${B}${B}

---

## 7. Monitoring (Post-Hackathon)

For hackathon submission, basic console logging is sufficient.

Future:
- Cloudflare Analytics for request metrics
- Sentry for error tracking
- Arize for Gemini call quality monitoring`;

export default content;
