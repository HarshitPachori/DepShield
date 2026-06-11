# DepShield - AI-Powered Dependency Intelligence

Scan GitHub and GitLab repositories for risky dependencies. Get AI-powered risk analysis and automated migration PRs.

🔗 **Live Demo:** https://depshield.hp3.workers.dev

> Built for the Google Cloud Rapid Agent Hackathon 2026. Currently optimized for Node.js projects. Python, Java, and Go support is in progress.

---

## What it does

- Scans repos for CVEs, deprecated packages, and silently abandoned libraries
- AI risk explanations powered by Gemini 2.5 Flash on Vertex AI
- Community Risk Intelligence powered by Elastic - leaderboard, co-risky package detection, full-text search across all scans
- Autonomous migration agent using Google Cloud Agent Builder that queries Elastic, searches the web, and decides migration strategy
- Auto-creates GitHub PRs and GitLab MRs with correct package versions and AI-transformed source files

---

## Try it

1. Go to https://depshield.hp3.workers.dev
2. Paste this test repo: `https://github.com/HarshitPachori/DepShield-Test-1`
3. Click Scan Now
4. Wait 2-3 minutes for full analysis
5. View risk report, community intelligence, and agent migration recommendations
6. Click Migrate on any high-risk package to create an automated PR

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| AI Enrichment | Gemini 2.5 Flash on Vertex AI |
| Migration Agent | Google Cloud Agent Builder (Reasoning Engine) |
| Community Intelligence | Elastic (nested aggregations, significant terms, full-text search) |
| MCP Server | Custom Cloudflare Worker exposing 10 tools to the agent |
| API Runtime | Hono on Cloudflare Workers |
| Queue Pipeline | Cloudflare Workers Queues |
| State | Cloudflare Workers KV |
| Database | Cloudflare D1 (SQLite) |
| Frontend | Next.js + Tailwind CSS |
| ORM | Drizzle ORM |
| CVE Data | OSV.dev API |
| Package Data | npm Registry, PyPI, Maven Central, Go Module Proxy |
| Repo APIs | GitHub API, GitLab API |

---

## Architecture

DepShield uses a parallel chunk-based scanning pipeline on Cloudflare Workers:

```
User submits repo URL
        |
Cloudflare Worker (scan route)
        |
Queue: processInitial
- Detect ecosystem (Node.js, Python, Java, Go)
- Parse dependencies from manifest file
- Split into chunks of 3 packages each
        |
Queue: processChunk (parallel, one per chunk)
- Fetch CVEs from OSV.dev (batch API + individual detail fetch)
- Fetch package metadata from npm/PyPI/Maven/Go registry
- Fetch commit activity from GitHub API
- Calculate risk score (0-100)
- Store chunk results in KV
        |
Queue: processMerge (triggered when all chunks complete)
- Merge and sort all results by risk score
- Index repo scan to Elastic (depshield-repo-scans)
- Store results in Cloudflare D1
        |
Queue: processGeminiEnrichment
- For CRITICAL/HIGH/MEDIUM packages
- Generate AI risk explanation via Gemini on Vertex AI
- Suggest alternatives enriched with Elastic community context
- Index migration signals to Elastic (depshield-signals)
        |
Queue: processAgentMigration
- Google Cloud Agent Builder session created
- Agent queries Elastic for health scores, alternatives, community patterns
- Agent uses Google Search for migration guides
- Agent decides needs_pr true/false per package with confidence score
        |
User clicks Migrate on dashboard
        |
Queue: processAgentPRCreation
- Agent calls create_github_pr or create_gitlab_mr MCP tool
- Tool resolves compatible version from registry + Gemini analysis
- Tool scans all source files via git tree API
- Tool transforms code using Gemini AI (handles API pattern migration)
- PR/MR created on target repo with all changes
- Migration signal indexed back to Elastic (feedback loop)
```

### Elastic Indices

| Index | Purpose |
|-------|---------|
| `depshield-cache` | Package risk scores, CVE data, cached per version with 24h TTL |
| `depshield-signals` | Migration patterns, deprecation notices, community alternatives |
| `depshield-repo-scans` | Full scan history per repo, powers leaderboard and co-risky detection |

### MCP Server Tools

Tools exposed to the Google Cloud Agent Builder agent:

| Tool | Description |
|------|-------------|
| `query_elastic` | Query package health, alternatives, trends, signals from Elastic |
| `search_scan_history` | Full-text search across all scanned repos |
| `get_risk_leaderboard` | Most commonly risky packages across all scans |
| `find_co_risky_packages` | Packages that commonly appear risky together |
| `create_github_pr` | Create migration PR on GitHub with code transformation |
| `create_gitlab_mr` | Create migration MR on GitLab with code transformation |
| `transform_file` | AI-powered code migration using Gemini |
| `index_alternative` | Index newly discovered alternatives back to Elastic |
| `check_github_ci_status` | Check GitHub Actions CI status |
| `check_ci_status` | Check GitLab CI pipeline status |

---

## Local Setup

### Prerequisites

- Node.js 18+
- Cloudflare account (free tier works)
- Google Cloud project with Vertex AI enabled
- Elasticsearch running locally via Docker
- GitHub token with `repo` scope

### 1. Clone and install

```bash
git clone https://github.com/YOUR_USERNAME/depshield
cd depshield
npm install
```

### 2. Start Elasticsearch locally

```bash
docker run -d --name elasticsearch \
  -p 9200:9200 \
  -e "discovery.type=single-node" \
  -e "xpack.security.enabled=false" \
  docker.elastic.co/elasticsearch/elasticsearch:8.11.0
```

### 3. Set up Cloudflare resources

```bash
# Create KV namespace
wrangler kv:namespace create "depshield-kv"

# Create D1 database
wrangler d1 create depshield-db

# Run migrations
wrangler d1 execute depshield-db --file=./drizzle/migrations/0000_init.sql

# Create queue
wrangler queues create depshield-scan-queue
```

Update `wrangler.jsonc` with the IDs from the above commands.

### 4. Set secrets

```bash
wrangler secret put GITHUB_TOKEN
wrangler secret put GITLAB_TOKEN
wrangler secret put GCP_SERVICE_ACCOUNT
wrangler secret put GOOGLE_CLOUD_PROJECT_ID
wrangler secret put GOOGLE_CLOUD_ENGINE_ID
wrangler secret put ELASTIC_URL
wrangler secret put ELASTIC_API_KEY
wrangler secret put ENCRYPTION_KEY
```

**GCP_SERVICE_ACCOUNT** should be the full JSON content of your Google Cloud service account key file.

**ENCRYPTION_KEY** should be a random 32-character string used to encrypt user PAT tokens at rest.

### 5. Deploy Cloudflare Worker

```bash
wrangler deploy
```

### 6. Deploy Google Cloud Agent

```bash
cd scripts
pip install google-cloud-aiplatform google-adk
python update_agent.py
```

Copy the ENGINE_ID printed at the end and set it:

```bash
wrangler secret put GOOGLE_CLOUD_ENGINE_ID
```

### 7. Start frontend locally

```bash
npm run dev
```

Open http://localhost:3000

### Notes

- First scan creates Elastic indices automatically with correct mappings
- Free Cloudflare account limits: 100k KV reads/day, 1k KV writes/day, 1k queue messages/day
- For production Elastic, use Elastic Cloud instead of local Docker

---

## Inspiration

Every developer has experienced that dreaded 2am production incident caused by a dependency nobody was watching. Tools like Snyk alert you about known CVEs but what about packages that are silently abandoned? No commits for 18 months, declining downloads, 47 open security issues with zero maintainer response. You find out when it breaks.

We built DepShield to close that gap. Not just detect risks, but automatically fix them.

---

## License

MIT License - see [LICENSE](LICENSE) file for details.