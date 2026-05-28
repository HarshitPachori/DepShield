const B = '`';

const content = `# Functional Specification Document (FSD)
## DepShield : AI-Powered Dependency Intelligence Agent

**Version:** 1.0  
**Date:** May 2026  
**Status:** Draft

---

## 1. User Flows

### 1.1 Core Flow - Scan & Migrate

${B}${B}${B}
┌─────────────────────────────────────────────────────────┐
│                    HAPPY PATH FLOW                      │
└─────────────────────────────────────────────────────────┘

[Landing Page]
User pastes repo URL
User clicks "Scan Now"
        │
        ▼
[Ecosystem Detection]
Agent detects: Node.js / npm
Package manager: pnpm
Lock file: pnpm-lock.yaml
        │
        ▼
[Scan Progress Page]
Real-time progress: 45/150 packages
Agent log visible
        │
        ▼
[Risk Dashboard]
Risk heatmap displayed
3 packages flagged Critical
47 flagged Medium
100 Safe
        │
        ▼
User clicks "request" package
        │
        ▼
[Package Detail Page]
Risk score: 94/100 CRITICAL
Health timeline chart
Explanation: "Deprecated since 2020..."
Recommendation: Migrate to axios
        │
        ▼
User clicks "Simulate Migration"
        │
        ▼
[Simulation Page]
Files affected: 3
Effort: ~2 hours manual
Before/After preview
Confidence: 91%
        │
        ▼
User clicks "Migrate Now"
Token prompt appears (if not saved)
User provides GitLab token
        │
        ▼
[Migration Status Page]
✓ Branch created
✓ 3 files transformed
✓ package.json updated
⟳ CI running...
✓ 47/47 tests passed
✓ MR created

[GitLab MR Link] →
${B}${B}${B}

---

### 1.2 Auth Flow

${B}${B}${B}
[Landing Page]
"Sign in with Google" clicked
        │
        ▼
Google OAuth consent screen
        │
        ▼
Redirect back to DepShield
User created/found in D1
        │
        ▼
Dashboard with scan history
${B}${B}${B}

---

### 1.3 Resume Flow (Page Refresh / Browser Closed)

${B}${B}${B}
User returns to depshield.pages.dev
        │
        ▼
Landing page shows Recent Scans
(from localStorage)
        │
        ▼
User clicks recent scan
        │
        ▼
jobId from localStorage
GET /api/status/:jobId
        │
   ┌────┴────┐
   │         │
Found     Not Found
(< 24hr)  (expired)
   │         │
Results   "Results expired"
shown     Re-scan button
${B}${B}${B}

---

## 2. Page Specifications

### 2.1 Landing Page ('/')

**Purpose:** Entry point - repo URL input + recent scans

**Components:**
- Hero section with tagline
- Repo URL input field
- Platform auto-detection badge (GitHub/GitLab)
- "Scan Now" CTA button
- Recent Scans list (from localStorage)
- Sign in with Google button

**Validations:**
- URL must be valid GitHub or GitLab URL
- Must be reachable (404 check before scan)
- Empty URL shows inline error

**States:**
- Default - input empty
- Detecting - platform badge appears after URL typed
- Loading - after submit, redirect to scan page
- Has history - recent scans shown below input

---

### 2.2 Scan Progress Page ('/scan?jobId=xxx')

**Purpose:** Real-time scan progress display

**Components:**
- Repo URL header
- Ecosystem detected badge
- Progress bar (x/total packages)
- Agent activity log (live stream)
- Package manager detected badge
- Cancel button

**States:**
- Scanning - progress bar animating
- Complete - auto-redirect to dashboard
- Error - error message + retry button
- Resumed - "Resuming scan..." message on load

---

### 2.3 Risk Dashboard ('/dashboard?jobId=xxx')

**Purpose:** Overview of all dependency risks

**Components:**
- Summary stats bar (Critical / High / Medium / Low / Safe counts)
- Risk heatmap (grid of packages colored by risk)
- Filterable package list (by risk level, ecosystem)
- Each package card shows: name, version, risk score, risk level badge, trajectory arrow
- "Migrate All Critical" batch action button
- Export report button

**Package Card:**
${B}${B}${B}
┌─────────────────────────────────────┐
│ 🔴 request                94/100   │
│ v2.88.0 → deprecated               │
│ ↓ Trajectory: CRITICAL             │
│ Recommendation: Migrate to axios   │
│ [Details] [Simulate] [Migrate]     │
└─────────────────────────────────────┘
${B}${B}${B}

---

### 2.4 Package Detail Page ('/dashboard?jobId=xxx&package=request')

**Purpose:** Deep dive into a single package risk

**Components:**
- Package name, version, ecosystem badge
- Risk score gauge (0–100)
- Risk level badge
- Health timeline chart (last 12 months)
- Signal breakdown:
  - Last commit: X months ago
  - Weekly downloads trend: ↓ -60%
  - Open CVEs: 3
  - Maintainer activity: Inactive
  - Deprecation status: Deprecated
- Plain English explanation (Gemini generated)
- Recommended alternative with compatibility score
- Action buttons: Simulate / Migrate Now

---

### 2.5 Simulation Page ('/simulate?jobId=xxx&package=request')

**Purpose:** Show predicted migration impact before executing

**Components:**
- Migration summary: from → to
- Files affected list with line counts
- Breaking changes catalog
- Code preview (before/after for 1 key file)
- Effort estimate
- Confidence score with explanation
- "Confirm & Migrate" button
- "Cancel" button

---

### 2.6 Migration Status Page ('/migrate?migrationId=xxx')

**Purpose:** Real-time migration execution status

**Components:**
- Migration header: "Migrating request → axios"
- Step-by-step agent log:
  - ✓ Branch created
  - ✓ Files analyzed
  - ✓ Code transformed (X files)
  - ✓ package.json updated
  - ⟳ CI pipeline running...
  - ✓ X/X tests passed
  - ✓ MR/PR created
- CI test results summary
- MR/PR link (opens GitLab/GitHub)
- Files changed summary with diff stats
- "View Another Package" button

---

### 2.7 Docs Pages ('/docs', '/docs/[slug]')

**Purpose:** In-app documentation

**Pages:**
- '/docs' - docs index with links
- '/docs/architecture' - system architecture
- '/docs/api' - API reference
- '/docs/setup' - local development setup

**Rendering:** react-markdown + remark-gfm from 'content/docs/*.md'

---

## 3. API Specifications

### POST /api/scan

**Request:**
${B}${B}${B}typescript
{
  repoUrl: string      // "https://github.com/user/repo"
  token?: string       // optional PAT for private repos
}
${B}${B}${B}

**Response:**
${B}${B}${B}typescript
{
  jobId: string        // UUID
  status: "pending"
  repoUrl: string
  platform: "github" | "gitlab"
  ecosystem: string | null
}
${B}${B}${B}

---

### GET /api/status/:jobId

**Response:**
${B}${B}${B}typescript
{
  jobId: string
  status: "pending" | "scanning" | "complete" | "error"
  progress: number
  total: number
  ecosystem: string
  packageManager: string
  results?: PackageRisk[]
  error?: string
}
${B}${B}${B}

---

### POST /api/simulate

**Request:**
${B}${B}${B}typescript
{
  jobId: string
  packageName: string
  repoUrl: string
  token?: string
}
${B}${B}${B}

**Response:**
${B}${B}${B}typescript
{
  simulationId: string
  fromPackage: string
  toPackage: string
  filesAffected: string[]
  breakingChanges: string[]
  effortHours: number
  confidence: number
  codePreview: {
    file: string
    before: string
    after: string
  }
}
${B}${B}${B}

---

### POST /api/migrate

**Request:**
${B}${B}${B}typescript
{
  jobId: string
  packageName: string
  repoUrl: string
  platform: "github" | "gitlab"
  token: string
}
${B}${B}${B}

**Response:**
${B}${B}${B}typescript
{
  migrationId: string
  status: "started"
}
${B}${B}${B}

---

### GET /api/migrate/:migrationId

**Response:**
${B}${B}${B}typescript
{
  migrationId: string
  status: "pending" | "branching" | "transforming" | "committing" | "ci_running" | "creating_mr" | "complete" | "error"
  steps: MigrationStep[]
  mrUrl?: string
  branchName?: string
  filesChanged?: number
  ciStatus?: "passing" | "failing" | "running"
  error?: string
}
${B}${B}${B}

---

## 4. Ecosystem Detection Logic

${B}${B}${B}typescript
const ECOSYSTEM_PRIORITY = [
  { files: ['package.json'],              ecosystem: 'nodejs',  supported: true  },
  { files: ['requirements.txt',
            'pyproject.toml'],            ecosystem: 'python',  supported: false },
  { files: ['go.mod'],                    ecosystem: 'go',      supported: false },
  { files: ['pom.xml', 'build.gradle'],   ecosystem: 'java',    supported: false },
  { files: ['Gemfile'],                   ecosystem: 'ruby',    supported: false },
  { files: ['composer.json'],             ecosystem: 'php',     supported: false },
  { files: ['Cargo.toml'],                ecosystem: 'rust',    supported: false },
]

const PACKAGE_MANAGER_DETECTION = [
  { file: 'bun.lockb',          manager: 'bun'  },
  { file: 'pnpm-lock.yaml',     manager: 'pnpm' },
  { file: 'yarn.lock',          manager: 'yarn' },
  { file: 'package-lock.json',  manager: 'npm'  },
]
${B}${B}${B}

---

## 5. Risk Scoring Algorithm

${B}${B}${B}typescript
interface RiskSignals {
  isDeprecated: boolean           // +40 if true
  lastCommitDaysAgo: number       // >365: +25, >180: +15, >90: +5
  downloadTrendPercent: number    // <-50%: +20, <-20%: +10
  openCveCount: number            // >5: +20, >0: +10
  maintainerActive: boolean       // false: +15
}

const calculateRiskScore = (signals: RiskSignals): number => {
  let score = 0
  
  if (signals.isDeprecated)              score += 40
  if (signals.lastCommitDaysAgo > 365)   score += 25
  else if (signals.lastCommitDaysAgo > 180) score += 15
  else if (signals.lastCommitDaysAgo > 90)  score += 5
  if (signals.downloadTrendPercent < -50)   score += 20
  else if (signals.downloadTrendPercent < -20) score += 10
  if (signals.openCveCount > 5)          score += 20
  else if (signals.openCveCount > 0)     score += 10
  if (!signals.maintainerActive)         score += 15

  return Math.min(score, 100)
}

const getRiskLevel = (score: number): RiskLevel => {
  if (score >= 80) return 'CRITICAL'
  if (score >= 60) return 'HIGH'
  if (score >= 40) return 'MEDIUM'
  if (score >= 20) return 'LOW'
  return 'SAFE'
}
${B}${B}${B}

---

## 6. Fix Strategy Decision Logic

${B}${B}${B}typescript
const determineFixStrategy = (pkg: PackageRisk): FixStrategy => {
  // Full migration needed
  if (pkg.isDeprecated) return 'migrate'
  if (pkg.lastCommitDaysAgo > 730) return 'migrate'
  
  // Version bump sufficient
  if (pkg.cveFixedVersion) return 'version_bump'
  
  // Monitoring only
  if (pkg.riskScore < 40) return 'monitor'
  
  return 'migrate'
}
${B}${B}${B}

---

## 7. Edge Cases

| Scenario | Handling |
|---|---|
| Monorepo with multiple package.json | Scan root + first-level workspace package.json files |
| Private repo without token | Show clear "token required" prompt, save token for future |
| 0 risky packages found | Show "All clear" state with green dashboard |
| Migration CI fails | Show failing tests, provide MR anyway with warning |
| Gemini transformation produces errors | Fallback: create MR with dependency update only, no code transform |
| Rate limit on external APIs | Queue with backoff, show "scanning slowly due to API limits" |
| Repo not found / 404 | Inline error before scan starts |
| Unsupported ecosystem | Show ecosystem detected + coming soon message |
| Page refresh during scan | Resume from URL jobId + KV stored progress |
| KV expired (>24hr) | Show "Results expired" + re-scan button |
| Token expired/invalid | Show clear auth error + token refresh prompt |
`;

export default content;
