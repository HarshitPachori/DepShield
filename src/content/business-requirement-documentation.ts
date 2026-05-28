const B = '`';
const content = `# Business Requirements Document (BRD)
## DepShield : AI-Powered Dependency Intelligence Agent

**Version:** 1.0  
**Date:** May 2026  
**Status:** Draft  
**Hackathon:** Google Cloud Rapid Agent Hackathon

---

## 1. Executive Summary

DepShield is an AI-powered dependency intelligence agent that scans software repositories for vulnerable and abandoned open-source packages. Unlike existing tools that only alert developers to known CVEs, DepShield detects silent abandonment risks and automatically creates tested migration Pull Requests or Merge Requests - eliminating hours of manual remediation work.

---

## 2. Problem Statement

### 2.1 Background

Modern software projects depend on hundreds of open-source packages. The average Node.js project has 150-600 direct and transitive dependencies. Developers rarely monitor the health of these packages after initial installation.

### 2.2 The Gap in Existing Solutions

| Tool | CVE Detection | Abandonment Detection | Auto-Migration |
|---|---|---|---|
| Snyk | ✅ | ❌ | ❌ |
| Dependabot | ✅ | ❌ | ❌ (version bumps only) |
| Socket.dev | ✅ | Partial | ❌ |
| Libraries.io | ❌ | Partial | ❌ |
| **DepShield** | ✅ | ✅ | ✅ |

### 2.3 Core Problem

Developers face two distinct dependency risks:

**Risk 1 - Known Vulnerabilities (CVEs)**
A specific version of a package has a documented security flaw. Existing tools handle this reasonably well.

**Risk 2 - Silent Abandonment**
A package is no longer maintained. No commits for 18+ months, declining downloads, community migrating elsewhere, no security patches being released. Developers discover this only when a CVE drops with no available fix, or when the package breaks due to incompatibility.

**The real cost:** A developer discovering a critical abandoned dependency spends 4-8 hours manually researching alternatives, migrating code, testing, and opening a PR. This happens repeatedly across teams.

### 2.4 Real-World Examples

- 'request' - 22M weekly downloads at peak, officially deprecated Feb 2020, millions of projects still use it
- 'node-uuid' - deprecated in favor of 'uuid'
- 'moment.js' - legacy mode, maintainers recommend migration to 'dayjs' or 'date-fns'
- 'event-stream' - compromised due to abandoned maintainer transferring ownership
- 'faker.js' - maintainer intentionally deleted the package overnight

---

## 3. Business Objectives

| # | Objective | Success Metric |
|---|---|---|
| 1 | Detect both CVE and abandonment risks | Risk detection accuracy >90% |
| 2 | Reduce manual migration time | From 4-8 hours to <5 minutes |
| 3 | Support multiple ecosystems | npm, Python, Go, Java, Ruby, PHP, Rust |
| 4 | Deliver actionable output | Tested PR/MR created automatically |
| 5 | Demonstrate meaningful MCP integration | Elastic MCP load-bearing in architecture |

---

## 4. Target Users

### 4.1 Primary User - Individual Developer

**Profile:**
- Full-stack or backend developer
- Works on 1-5 projects simultaneously
- Uses npm, pip, or Go modules
- Aware of Snyk/Dependabot but frustrated by alert fatigue

**Pain Point:**
Receives 50+ Dependabot alerts per month. Most are noise. The ones that matter require hours of manual work to fix.

**Goal:**
Paste a repo URL, understand which dependencies are actually dangerous, and get a ready-to-merge fix automatically.

### 4.2 Secondary User - Engineering Team Lead

**Profile:**
- Manages 3-10 engineers
- Responsible for codebase security and technical debt
- Reviews PRs before merge

**Pain Point:**
No visibility into dependency health across the team's projects. Technical debt accumulates silently.

**Goal:**
Weekly dependency health report across all team repos. Auto-generated PRs that engineers can review and merge without additional research.

### 4.3 Tertiary User - Open Source Maintainer

**Profile:**
- Maintains a public library or tool
- Wants to keep dependencies current
- Limited time for maintenance tasks

**Pain Point:**
Manually tracking which dependencies are becoming risky is time-consuming.

**Goal:**
Automated dependency health monitoring with minimal setup.

---

## 5. Scope

### 5.1 In Scope - MVP (Hackathon Submission)

- Repository scanning via public GitHub/GitLab URL
- Ecosystem detection: npm, Python, Go, Java, Ruby, PHP, Rust
- Full scan + migration: npm only
- Risk detection: CVE check via OSV.dev + abandonment via npm/GitHub APIs
- Elastic MCP for intelligent package signal search
- GitLab MCP for automated MR creation
- GitHub REST API for automated PR creation
- Risk dashboard with heatmap
- Migration simulation (dry run)
- Automated migration with CI + MR/PR creation
- Google OAuth authentication
- Encrypted PAT token storage
- Scan history with resume capability
- Documentation site (markdown rendered in-app)

### 5.2 Out of Scope - MVP

- Full migration support for Python, Go, Java (detection only)
- Bitbucket support
- Slack/Discord notifications
- Team/organization accounts
- CI/CD pipeline integration (GitHub Actions, GitLab CI config)
- Paid plans / billing

### 5.3 Post-Hackathon Roadmap

- Full migration for Python, Go, Java
- Bitbucket support
- Team dashboards
- Slack/Discord/Email notifications
- GitHub App integration
- Scheduled automatic scans
- PR review agent

---

## 6. Functional Requirements

### 6.1 Repository Scanning

| ID | Requirement | Priority |
|---|---|---|
| FR-001 | Accept GitHub and GitLab repo URLs | P0 |
| FR-002 | Auto-detect ecosystem from repo files | P0 |
| FR-003 | Parse package.json for npm dependencies | P0 |
| FR-004 | Parse requirements.txt / pyproject.toml for Python | P1 |
| FR-005 | Parse go.mod for Go | P1 |
| FR-006 | Parse pom.xml / build.gradle for Java | P1 |
| FR-007 | Detect package manager (npm/yarn/pnpm/bun) | P1 |
| FR-008 | Show unsupported ecosystems with roadmap message | P0 |
| FR-009 | Handle rate limiting across external APIs | P0 |
| FR-010 | Show real-time scan progress | P0 |

### 6.2 Risk Detection

| ID | Requirement | Priority |
|---|---|---|
| FR-011 | Check CVEs via OSV.dev for all ecosystems | P0 |
| FR-012 | Check npm deprecation flag | P0 |
| FR-013 | Check last commit date via GitHub API | P0 |
| FR-014 | Check download trend via npm Registry API | P0 |
| FR-015 | Calculate combined risk score (0-100) | P0 |
| FR-016 | Classify risk level: Critical/High/Medium/Low/Safe | P0 |
| FR-017 | Determine fix strategy: version bump vs full migration | P0 |
| FR-018 | Search Elastic for community migration discussions | P0 |
| FR-019 | Find best alternative package via Elastic semantic search | P0 |

### 6.3 Migration

| ID | Requirement | Priority |
|---|---|---|
| FR-020 | Simulate migration before executing | P0 |
| FR-021 | Show affected files and effort estimate | P0 |
| FR-022 | Show before/after code preview | P0 |
| FR-023 | Create branch via GitLab MCP | P0 |
| FR-024 | Transform code files using Gemini | P0 |
| FR-025 | Commit changes via GitLab MCP | P0 |
| FR-026 | Trigger CI pipeline via GitLab MCP | P1 |
| FR-027 | Create MR with full description via GitLab MCP | P0 |
| FR-028 | Create PR via GitHub REST API | P0 |
| FR-029 | Show migration status in real-time | P0 |

### 6.4 Authentication & Security

| ID | Requirement | Priority |
|---|---|---|
| FR-030 | Google OAuth login | P0 |
| FR-031 | Store PAT tokens encrypted (AES-256-GCM) | P0 |
| FR-032 | Allow anonymous scanning (no login required) | P1 |
| FR-033 | User can delete stored tokens | P0 |

---

## 7. Non-Functional Requirements

| Category | Requirement |
|---|---|
| Performance | Scan 150 packages in <15 seconds |
| Availability | 99% uptime during hackathon judging period |
| Security | PAT tokens encrypted at rest, never logged |
| Scalability | Cloudflare edge - globally distributed |
| Compatibility | Chrome, Firefox, Safari - desktop and mobile |

---

## 8. Constraints

| Constraint | Detail |
|---|---|
| Hackathon deadline | June 11, 2026 |
| Must use | Google Cloud Agent Builder + Gemini |
| Must use | At least one Partner MCP (Elastic) |
| Repo must be | Public + MIT License |
| Demo video | ~3 minutes |
| Hosting | Must be live URL |

---

## 9. Success Criteria

The project is considered successful if:

1. A user can paste any public npm-based GitHub or GitLab repo URL and receive a risk report within 15 seconds
2. For a high-risk package, the agent creates a tested MR/PR automatically
3. The Elastic MCP is demonstrably load-bearing in the architecture
4. The demo video clearly shows the before/after workflow in under 3 minutes
5. Judges can test the live hosted URL themselves`;

export default content;
