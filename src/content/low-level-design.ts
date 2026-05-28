const B = '`';

const content = `# Low Level Design (LLD)
## DepShield : AI-Powered Dependency Intelligence Agent

**Version:** 1.0  
**Date:** May 2026

---

## 1. Database Schema (Drizzle + Cloudflare D1)

${B}${B}${B}typescript
// src/backend/db/schema.ts

import { sql } from 'drizzle-orm'
import { text, integer, sqliteTable } from 'drizzle-orm/sqlite-core'

// ─── Users ───────────────────────────────────────────────────
export const users = sqliteTable('users', {
  id: text('id').primaryKey(),                          // UUID
  googleId: text('google_id').unique().notNull(),
  email: text('email').unique().notNull(),
  name: text('name'),
  avatarUrl: text('avatar_url'),
  createdAt: integer('created_at').default(sql'(unixepoch())'),
  updatedAt: integer('updated_at').default(sql'(unixepoch())'),
})

// ─── PAT Tokens ──────────────────────────────────────────────
export const patTokens = sqliteTable('pat_tokens', {
  id: text('id').primaryKey(),                          // UUID
  userId: text('user_id').notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  platform: text('platform').notNull(),                 // 'github' | 'gitlab'
  encryptedToken: text('encrypted_token').notNull(),    // AES-256-GCM
  label: text('label'),                                 // "Work GitHub"
  lastUsedAt: integer('last_used_at'),
  createdAt: integer('created_at').default(sql'(unixepoch())'),
})

// ─── Scan Jobs ───────────────────────────────────────────────
export const scanJobs = sqliteTable('scan_jobs', {
  id: text('id').primaryKey(),                          // UUID
  userId: text('user_id')
    .references(() => users.id),                        // nullable (anonymous)
  repoUrl: text('repo_url').notNull(),
  platform: text('platform').notNull(),                 // 'github' | 'gitlab'
  ecosystem: text('ecosystem'),                         // 'nodejs' | 'python' etc
  packageManager: text('package_manager'),              // 'npm' | 'pnpm' | 'bun'
  status: text('status').default('pending'),            // pending|scanning|complete|error
  progress: integer('progress').default(0),
  totalPackages: integer('total_packages').default(0),
  error: text('error'),
  createdAt: integer('created_at').default(sql'(unixepoch())'),
  completedAt: integer('completed_at'),
})

// ─── Scan Results ────────────────────────────────────────────
export const scanResults = sqliteTable('scan_results', {
  id: text('id').primaryKey(),                          // UUID
  jobId: text('job_id').notNull()
    .references(() => scanJobs.id, { onDelete: 'cascade' }),
  totalPackages: integer('total_packages'),
  criticalCount: integer('critical_count').default(0),
  highCount: integer('high_count').default(0),
  mediumCount: integer('medium_count').default(0),
  lowCount: integer('low_count').default(0),
  safeCount: integer('safe_count').default(0),
  resultsJson: text('results_json'),                    // JSON stringified PackageRisk[]
  createdAt: integer('created_at').default(sql'(unixepoch())'),
})

// ─── Migration Jobs ──────────────────────────────────────────
export const migrationJobs = sqliteTable('migration_jobs', {
  id: text('id').primaryKey(),                          // UUID
  userId: text('user_id').notNull()
    .references(() => users.id),
  scanJobId: text('scan_job_id').notNull()
    .references(() => scanJobs.id),
  packageName: text('package_name').notNull(),          // "request"
  fromVersion: text('from_version'),                    // "^2.88.0"
  toPackage: text('to_package'),                        // "axios"
  toVersion: text('to_version'),                        // "^1.7.4"
  strategy: text('strategy').notNull(),                 // 'migrate' | 'version_bump'
  status: text('status').default('pending'),
  branchName: text('branch_name'),
  mrUrl: text('mr_url'),
  prUrl: text('pr_url'),
  filesChanged: integer('files_changed'),
  ciStatus: text('ci_status'),                          // 'passing' | 'failing'
  stepsJson: text('steps_json'),                        // JSON migration steps
  error: text('error'),
  createdAt: integer('created_at').default(sql'(unixepoch())'),
  completedAt: integer('completed_at'),
})
${B}${B}${B}

---

## 2. TypeScript Types

${B}${B}${B}typescript
// src/types/index.ts

export type Platform = 'github' | 'gitlab'
export type Ecosystem = 'nodejs' | 'python' | 'go' | 'java' | 'ruby' | 'php' | 'rust'
export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun'
export type RiskLevel = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'SAFE'
export type FixStrategy = 'migrate' | 'version_bump' | 'monitor'
export type ScanStatus = 'pending' | 'scanning' | 'complete' | 'error'
export type MigrationStatus = 
  | 'pending' 
  | 'analyzing' 
  | 'branching' 
  | 'transforming' 
  | 'committing' 
  | 'ci_running' 
  | 'creating_mr' 
  | 'complete' 
  | 'error'

export interface PackageRisk {
  name: string
  declaredVersion: string
  installedVersion?: string
  ecosystem: Ecosystem
  riskScore: number                    // 0-100
  riskLevel: RiskLevel
  fixStrategy: FixStrategy
  signals: RiskSignals
  explanation: string                  // Gemini generated
  recommendation?: string             // "Migrate to axios"
  alternative?: string                // "axios"
  alternativeCompatibility?: number   // 0-100
  cves: CVE[]
}

export interface RiskSignals {
  isDeprecated: boolean
  lastCommitDaysAgo: number
  downloadTrendPercent: number
  openCveCount: number
  maintainerActive: boolean
  weeklyDownloads: number
  communitySignal: string             // Elastic search result summary
}

export interface CVE {
  id: string                          // "CVE-2023-45857"
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
  affectedVersions: string[]
  fixedVersion?: string
  description: string
}

export interface MigrationStep {
  step: string
  status: 'pending' | 'running' | 'complete' | 'error'
  message?: string
  timestamp?: number
}

export interface EcosystemDetection {
  ecosystem: Ecosystem | null
  packageManager: PackageManager | null
  dependencyFile: string | null
  lockFile: string | null
  supported: boolean
}

export interface SimulationResult {
  simulationId: string
  fromPackage: string
  toPackage: string
  filesAffected: AffectedFile[]
  breakingChanges: string[]
  effortHours: number
  confidence: number
  codePreview: CodePreview
}

export interface AffectedFile {
  path: string
  linesChanged: number
  patterns: string[]
}

export interface CodePreview {
  file: string
  before: string
  after: string
}
${B}${B}${B}

---

## 3. Service Layer Interfaces

### 3.1 Scanner Service

${B}${B}${B}typescript
// src/backend/services/scanner.service.ts

export interface ScannerService {
  detectEcosystem(repoUrl: string, token?: string): Promise<EcosystemDetection>
  parseDependencies(repoUrl: string, ecosystem: Ecosystem, token?: string): Promise<Record<string, string>>
  scanPackage(name: string, version: string, ecosystem: Ecosystem): Promise<PackageRisk>
  scanAllPackages(
    deps: Record<string, string>,
    ecosystem: Ecosystem,
    onProgress: (scanned: number, total: number) => void
  ): Promise<PackageRisk[]>
}
${B}${B}${B}

### 3.2 Elastic Service

${B}${B}${B}typescript
// src/backend/services/elastic.service.ts

export interface ElasticService {
  indexPackageSignal(signal: PackageSignal): Promise<void>
  searchPackageHealth(packageName: string, ecosystem: string): Promise<ElasticSearchResult[]>
  searchMigrationGuides(fromPackage: string): Promise<MigrationGuide[]>
  findAlternatives(packageName: string, ecosystem: string): Promise<Alternative[]>
  bulkIndexSignals(signals: PackageSignal[]): Promise<void>
}

export interface PackageSignal {
  packageName: string
  ecosystem: string
  signalType: 'cve' | 'abandonment' | 'community' | 'deprecation' | 'alternative'
  signalText: string
  source: string
  date: string
  sentimentScore: number
}
${B}${B}${B}

### 3.3 GitLab Service

${B}${B}${B}typescript
// src/backend/services/gitlab.service.ts

export interface GitLabService {
  getFile(repoUrl: string, filePath: string, token: string): Promise<string>
  listFiles(repoUrl: string, token: string): Promise<string[]>
  searchCode(repoUrl: string, query: string, token: string): Promise<CodeSearchResult[]>
  createBranch(repoUrl: string, branchName: string, token: string): Promise<void>
  commitFiles(repoUrl: string, branch: string, files: FileCommit[], token: string): Promise<void>
  triggerPipeline(repoUrl: string, branch: string, token: string): Promise<string>
  getPipelineStatus(repoUrl: string, pipelineId: string, token: string): Promise<PipelineStatus>
  createMergeRequest(repoUrl: string, mr: CreateMRInput, token: string): Promise<string>
}
${B}${B}${B}

### 3.4 GitHub Service

${B}${B}${B}typescript
// src/backend/services/github.service.ts

export interface GitHubService {
  getFile(repoUrl: string, filePath: string, token?: string): Promise<string>
  listFiles(repoUrl: string, token?: string): Promise<string[]>
  searchCode(repoUrl: string, query: string, token: string): Promise<CodeSearchResult[]>
  createBranch(repoUrl: string, branchName: string, token: string): Promise<void>
  commitFiles(repoUrl: string, branch: string, files: FileCommit[], token: string): Promise<void>
  createPullRequest(repoUrl: string, pr: CreatePRInput, token: string): Promise<string>
  getCommitActivity(owner: string, repo: string): Promise<CommitActivity>
}
${B}${B}${B}

### 3.5 OSV Service

${B}${B}${B}typescript
// src/backend/services/osv.service.ts

export interface OSVService {
  queryCVEs(packageName: string, ecosystem: string, version?: string): Promise<CVE[]>
  batchQueryCVEs(packages: PackageQuery[]): Promise<Map<string, CVE[]>>
}

export interface PackageQuery {
  name: string
  ecosystem: string
  version?: string
}
${B}${B}${B}

### 3.6 Migration Service

${B}${B}${B}typescript
// src/backend/services/migration.service.ts

export interface MigrationService {
  simulate(input: SimulateInput): Promise<SimulationResult>
  execute(input: MigrateInput, onStep: (step: MigrationStep) => void): Promise<MigrationResult>
  transformCode(file: string, content: string, fromPkg: string, toPkg: string): Promise<string>
  generateMRDescription(result: MigrationResult): Promise<string>
}
${B}${B}${B}

---

## 4. Hono Route Handlers

${B}${B}${B}typescript
// src/api/[[...route]]/route.ts

import { Hono } from 'hono'
import { handle } from 'hono/vercel'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'

const app = new Hono().basePath('/api')

// ─── Scan ─────────────────────────────────────────────────────
app.post('/scan', 
  zValidator('json', z.object({
    repoUrl: z.string().url(),
    token: z.string().optional(),
  })),
  async (c) => {
    const { repoUrl, token } = c.req.valid('json')
    // Create job, push to queue, return jobId
  }
)

// ─── Status ───────────────────────────────────────────────────
app.get('/status/:jobId',
  async (c) => {
    const jobId = c.req.param('jobId')
    // Fetch from KV first, fallback to D1
  }
)

// ─── Simulate ─────────────────────────────────────────────────
app.post('/simulate',
  zValidator('json', z.object({
    jobId: z.string(),
    packageName: z.string(),
    repoUrl: z.string().url(),
    token: z.string().optional(),
  })),
  async (c) => { }
)

// ─── Migrate ──────────────────────────────────────────────────
app.post('/migrate',
  zValidator('json', z.object({
    jobId: z.string(),
    packageName: z.string(),
    repoUrl: z.string().url(),
    platform: z.enum(['github', 'gitlab']),
    token: z.string(),
  })),
  async (c) => { }
)

app.get('/migrate/:migrationId', async (c) => { })

// ─── Tokens ───────────────────────────────────────────────────
app.post('/tokens', async (c) => { })
app.delete('/tokens/:id', async (c) => { })
app.get('/tokens', async (c) => { })

export const GET = handle(app)
export const POST = handle(app)
export const DELETE = handle(app)
${B}${B}${B}

---

## 5. Encryption Utility

${B}${B}${B}typescript
// src/backend/util/encryption.ts

const ALGORITHM = 'AES-GCM'

export const encryptToken = async (token: string, key: string): Promise<string> => {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(key.padEnd(32).slice(0, 32)),
    ALGORITHM,
    false,
    ['encrypt']
  )
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encrypted = await crypto.subtle.encrypt(
    { name: ALGORITHM, iv },
    cryptoKey,
    new TextEncoder().encode(token)
  )
  const combined = new Uint8Array(iv.length + encrypted.byteLength)
  combined.set(iv)
  combined.set(new Uint8Array(encrypted), iv.length)
  return btoa(String.fromCharCode(...combined))
}

export const decryptToken = async (encrypted: string, key: string): Promise<string> => {
  const combined = Uint8Array.from(atob(encrypted), c => c.charCodeAt(0))
  const iv = combined.slice(0, 12)
  const data = combined.slice(12)
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(key.padEnd(32).slice(0, 32)),
    ALGORITHM,
    false,
    ['decrypt']
  )
  const decrypted = await crypto.subtle.decrypt(
    { name: ALGORITHM, iv },
    cryptoKey,
    data
  )
  return new TextDecoder().decode(decrypted)
}
${B}${B}${B}

---

## 6. Elastic Index Mappings

${B}${B}${B}json
{
  "mappings": {
    "properties": {
      "package_name":    { "type": "keyword" },
      "ecosystem":       { "type": "keyword" },
      "signal_type":     { "type": "keyword" },
      "signal_text":     { "type": "text", "analyzer": "english" },
      "signal_embedding":{ "type": "dense_vector", "dims": 768, "index": true, "similarity": "cosine" },
      "source":          { "type": "keyword" },
      "date":            { "type": "date" },
      "sentiment_score": { "type": "float" },
      "weekly_downloads":{ "type": "long" },
      "commit_count":    { "type": "integer" }
    }
  }
}
${B}${B}${B}

---

## 7. Environment Variables

${B}${B}${B}typescript
// cloudflare-env.d.ts

interface CloudflareEnv {
  // D1
  DB: D1Database

  // KV
  KV: KVNamespace

  // Queues
  SCAN_QUEUE: Queue
  MIGRATION_QUEUE: Queue

  // Secrets
  ENCRYPTION_KEY: string
  NEXTAUTH_SECRET: string
  GOOGLE_CLIENT_ID: string
  GOOGLE_CLIENT_SECRET: string

  // Elastic
  ELASTIC_URL: string
  ELASTIC_API_KEY: string
  ELASTIC_MCP_ENDPOINT: string

  // GitHub
  GITHUB_TOKEN: string

  // Google Cloud
  GOOGLE_CLOUD_PROJECT_ID: string
  GOOGLE_CLOUD_LOCATION: string
  VERTEX_AI_API_KEY: string
}
${B}${B}${B}`;

export default content;
