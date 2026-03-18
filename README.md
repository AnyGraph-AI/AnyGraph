# AnythingGraph

**A knowledge graph that gives AI agents structural awareness before they edit code.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Tests](https://img.shields.io/badge/tests-1%2C052_passing-brightgreen)]()
[![Neo4j](https://img.shields.io/badge/Neo4j-5.x-008CC1?logo=neo4j)](https://neo4j.com/)
[![MCP Tools](https://img.shields.io/badge/MCP_tools-57-purple)]()

---

[The Problem](#the-problem) · [The Solution](#the-solution) · [See It Working](#this-is-running-right-now) · [Features](#features) · [Quick Start](#quick-start) · [CLI](#cli-commands) · [MCP Tools](#mcp-tools-57) · [Schema](#graph-schema) · [Architecture](#architecture) · [What's Next](#whats-next)

---

## The Problem

AI coding agents break things. They edit a function without knowing 47 other functions call it. They refactor a file without knowing it co-changes with three others every time. They mark a task "done" without knowing the code they wrote doesn't match the plan. They ship untested changes to critical infrastructure because they can't see risk.

**The root cause:** Agents operate on files. Codebases operate on *connections* — call graphs, state flows, temporal coupling, plan dependencies. No single file contains this information. It emerges from the structure.

## The Solution

AnythingGraph parses your codebase into a Neo4j knowledge graph, then gives AI agents 57 tools to query it before they edit anything.

**What agents can do with it:**
- **"What breaks if I change this?"** → Query the call graph. See every caller, every state dependency, every co-changing file.
- **"Is this safe to touch?"** → Check the risk tier. CRITICAL functions with high fan-in and no tests get blocked at the gate.
- **"What should I work on next?"** → Query the plan graph. Get the next unblocked task with its dependencies resolved.
- **"Did my change actually satisfy the plan?"** → Cross-reference: task → code evidence → test coverage → verification run.

**Before AnythingGraph:** Agent reads a file, makes a change, hopes for the best.
**After AnythingGraph:** Agent queries blast radius, checks risk tier, verifies test coverage, runs the enforcement gate, then edits — or gets blocked if the change is too dangerous without tests.

```
# An agent asks: "What's the blast radius of editing this function?"
cypher-shell -u neo4j -p codegraph \
  "MATCH (caller)-[:CALLS]->(f:Function {name: 'resolveRiskTier'})
   RETURN caller.name, caller.riskTier, caller.filePath"

# Result: 12 callers, 3 CRITICAL, 2 untested — gate blocks the edit until tests exist.
```

It's not just code. AnythingGraph ingests **plans, documents, and claims** into the same graph — so agents can reason across domains. A plan task links to the code it produced, which links to the tests that verify it, which links to the verification runs that grade confidence. One graph. Full traceability.

## This Is Running Right Now

AnythingGraph isn't a concept — it's running on its own codebase, catching real issues, blocking real regressions. Here's live output:

**Risk detection** — functions ranked by how many callers depend on them:
```
$ cypher-shell "MATCH (caller)-[:CALLS]->(f {projectId:'proj_c0d3e9a1f200'})
  WITH f, count(caller) AS callers WHERE callers > 5
  RETURN f.name, callers, f.riskTier ORDER BY callers DESC LIMIT 5"

 f.name                          | callers | f.riskTier
---------------------------------+---------+-----------
 "run"                           | 156     | "HIGH"
 "close"                         | 119     | "HIGH"
 "importSarifToVerificationBundle"| 34     | "LOW"
 "fetchQuery"                    | 24      | "LOW"
 "createEphemeralGraph"          | 8       | "MEDIUM"
```

**Next unblocked task** — the graph knows what's ready to work on:
```
$ cypher-shell "MATCH (t:Task {status:'planned'})-[:PART_OF]->(m:Milestone)
  WHERE NOT EXISTS { MATCH (t)-[:DEPENDS_ON]->(d:Task) WHERE d.status <> 'done' }
  RETURN t.name, m.name LIMIT 3"

 "Query graph for god files by role..."  | "RF-16: God File Refactoring"
 "Create project registry..."            | "RF-17: Graph Write Gate"
 "Pause broad expansion..."              | "N0: Audit Closure First"
```

**Enforcement gate** — blocks edits to dangerous untested code:
```
$ codegraph enforce src/core/parsers/plan-parser.ts --mode enforced

🚫 BLOCK — 9 CRITICAL functions in untested file.
   Write tests before editing. Gate will re-evaluate after TESTED_BY edges exist.
```

**Self-diagnosis** — the graph knows what it doesn't know:
```
$ npm run self-diagnosis

📊 Health: 23/39 checks pass, 16 need attention
❌ D15: 169 CRITICAL/HIGH functions have no test coverage
❌ D17: 2,234 claims cannot reach source code (broken evidence chains)
✅ D24: Governance stable across 70 snapshots — no regression
✅ D32: No ENFORCED invariant violations — graph is in a legal state
```

This is the real graph, real queries, real output. Not mock data.

## Features

- 🔍 **Blast radius analysis** — see every caller, callee, and state dependency before editing
- 🚦 **Enforcement gate** — CRITICAL untested functions get blocked. No exceptions, no overrides.
- 📊 **Risk scoring** — composite risk from fan-in, fan-out, churn, temporal coupling, test coverage
- 📋 **Plan tracking** — tasks, milestones, sprints in the graph with auto-completion detection
- 🔗 **Cross-domain reasoning** — plan tasks link to code, code links to tests, tests link to verification runs
- 🤖 **57 MCP tools** — agents query the graph through a standard tool interface
- 🧪 **Temporal confidence** — verification results decay over time, evidence has expiry, nothing is trusted forever
- 🔄 **Self-audit** — the graph generates verification questions, agents answer them, the graph updates itself
- 📈 **69-step governance pipeline** — build, enrich, verify, integrity check, hygiene, metrics — all automated
- 🧬 **Hermetic testing** — frozen clock, network guard, ephemeral graph, seeded RNG — deterministic by design

## Current State

- **31,137 nodes, 54,511 edges** across 8 projects (1 code, 6 plan/governance, 1 test)
- **1,052 tests** across 73 suites
- **v0.1.0** — TypeScript parser only (Python, Go, Java on roadmap)

## Projects in the Graph

| Domain | Projects | What's In Them |
|--------|----------|----------------|
| Code | CodeGraph (self-graph) | TypeScript AST → nodes/edges, risk scoring, blast radius |
| Plans | codegraph, plan-graph, runtime-graph, governance-org, hygiene-governance, hygiene-ai | Task/Milestone/Sprint tracking, auto-completion detection |
| Document | IR scaffold | Document adapter proof-of-concept |
| Claims | (cross-cutting) | Cross-layer synthesis, self-audit verdicts, hypotheses |

## Quick Start

### Prerequisites

- Node.js 22+
- Neo4j 5.x (native install, not Docker)
- `npm install` in this directory

### Start Neo4j

```bash
sudo neo4j start
# Auth: neo4j / codegraph — bolt://localhost:7687
```

### Parse a TypeScript project

```bash
# Parse and ingest to Neo4j
npx tsx src/scripts/entry/parse-and-ingest.ts

# Parse CodeGraph itself (self-graph)
npx tsx src/scripts/entry/parse-and-ingest-self.ts

# Run enrichment (risk scoring, temporal coupling, provenance, etc.)
npm run enrich:temporal-coupling
npm run enrich:author-ownership
npm run enrich:git-frequency
npm run enrich:provenance
```

### Query the graph

```bash
# List all projects
cypher-shell -u neo4j -p codegraph \
  "MATCH (p:Project) RETURN p.displayName, p.projectId, p.nodeCount, p.edgeCount"

# Find riskiest functions
cypher-shell -u neo4j -p codegraph \
  "MATCH (f:CodeNode {projectId: 'proj_c0d3e9a1f200'})
   WHERE f.riskTier IN ['CRITICAL', 'HIGH']
   RETURN f.name, f.riskTier, f.kind
   ORDER BY f.riskLevel DESC LIMIT 10"
```

### Run the governance pipeline

```bash
# Full 57-step done-check (build → enrich → verify → integrity)
npm run done-check

# Run tests
npx vitest run
```

### Start the MCP server

```bash
node dist/mcp/mcp.server.js

# Or configure for Claude Code (.mcp.json):
{
  "mcpServers": {
    "codegraph": {
      "command": "node",
      "args": ["/path/to/codegraph/dist/mcp/mcp.server.js"]
    }
  }
}
```

## CLI Commands

### Core

| Command | What It Does |
|---------|-------------|
| `codegraph parse <dir>` | Parse TypeScript project. Auto-detects existing projectId (MERGE mode). `--fresh` for destructive wipe. |
| `codegraph enrich [projectId]` | Run post-ingest enrichment pipeline |
| `codegraph analyze <dir>` | Parse + enrich in one shot |
| `codegraph serve` | Start MCP server (57 tools) |
| `codegraph status` | Show Neo4j and project status |
| `codegraph risk <target>` | Query blast radius for a function |
| `codegraph probe` | **46 architecture probes** — risk, coupling, entrypoints, verification coverage, shadow divergence, cross-layer analysis |
| `codegraph diagnose` | **39 health checks** with next-step guidance — does the graph know what it doesn't know? |

### Governance Pipeline

| Command | What It Does |
|---------|-------------|
| `npm run done-check` | Full 69-step pipeline: build → enrich → verify → integrity → TC → governance → hygiene → metrics |
| `npm run rebuild-derived` | Delete all derived edges + properties, re-run 12 enrichment scripts in dependency order |
| `npm run probe-architecture` | Same as `codegraph probe` |
| `npm run self-diagnosis` | Same as `codegraph diagnose` |
| `npm run verification:scan` | Run Semgrep + ESLint, import SARIF as VerificationRun nodes |
| `npm run graph:metrics` | Record GraphMetricsSnapshot node (tracks growth over time) |
| `npm run integrity:snapshot` | Snapshot current invariant state |
| `npm run integrity:verify` | Verify latest snapshot against baselines |
| `npm run governance:metrics:snapshot` | Record GovernanceMetricSnapshot node (governance health over time) |
| `npm run governance:metrics:integrity:verify` | Verify governance metrics against baselines (drift detection) |
| `npm run verification:status:dashboard` | TC pipeline dashboard — per-family confidence stats, blocked/eligible counts |
| `npm run verification:recommendation:mismatch` | Detect tasks recommended but already done (VG-6 mismatch metric, target: 0%) |

### Enrichment Scripts (run individually or via done-check)

| Category | Commands |
|----------|---------|
| **Structural** (post-parse) | `enrich:temporal-coupling`, `enrich:vr-scope`, `enrich:evidence-anchor`, `enrich:claim-project`, `enrich:evidence-project` |
| **Git-derived** (needs repo) | `enrich:git-frequency`, `enrich:author-ownership` |
| **On-demand** (expensive/batch) | `enrich:composite-risk`, `enrich:flags-edges`, `enrich:entrypoint-edges`, `enrich:state-fields`, `enrich:provenance` |

### Graph History

GraphMetricsSnapshot nodes track graph growth over time. Each `done-check` run creates a snapshot with:
- `nodeCount`, `edgeCount`, `derivedEdgeCount`, `derivedEdgeRatio`
- `avgDegree`, `maxDegree`, `maxDegreeNodeName`
- `edgeTypeDistributionJson`, `labelDistributionJson`
- `timestamp` (datetime)

Query growth history:
```bash
cypher-shell -u neo4j -p codegraph "
  MATCH (s:GraphMetricsSnapshot)
  RETURN s.timestamp, s.nodeCount, s.edgeCount, s.derivedEdgeCount
  ORDER BY s.timestamp"
```

### Governance Health History

GovernanceMetricSnapshot nodes track governance health over time. Each `done-check` creates a snapshot with:
- Done-check pass/fail/warn results and head SHA
- Gate interception rate, invariant violations, verification run counts
- MEASURED edges linking snapshots to MetricResult nodes

Query governance trend:
```bash
cypher-shell -u neo4j -p codegraph "
  MATCH (m:GovernanceMetricSnapshot)
  RETURN m.id, m.ranAt, m.result, m.headSha
  ORDER BY m.ranAt DESC LIMIT 10"
```

`governance:metrics:integrity:verify` compares latest governance snapshot against baseline — flags regressions (e.g., pass→fail, rising invariant violations, gate interception drops).

### TC Pipeline Dashboard

`verification:status:dashboard` outputs a JSON summary of the Temporal Confidence pipeline state:
- Per source-family stats: VR count, avg/min/max effectiveConfidence, blocked count
- Promotion eligibility, calibration metrics (Brier, ECE)
- Debt and shadow divergence summaries

### Recommendation Mismatch (VG-6)

`verification:recommendation:mismatch` checks whether the dependency-aware task recommendation query would surface any task already marked done. A non-zero mismatch rate means the recommendation engine is stale relative to plan progress. Policy target: `mismatchRate = 0`.

## Graph Schema

### Node Labels

**Code nodes** use a multi-label model: every code declaration is a `CodeNode` with additional labels for language (`TypeScript`) and kind (`Function`, `Method`, `Class`, etc.).

| Label | What It Represents |
|-------|-------------------|
| `CodeNode:TypeScript:Function` | Named function |
| `CodeNode:TypeScript:Method` | Class method |
| `CodeNode:TypeScript:Class` | Class declaration |
| `CodeNode:TypeScript:Interface` | Interface declaration |
| `CodeNode:TypeScript:Variable` | const/let/var |
| `CodeNode:TypeScript:TypeAlias` | type X = ... |
| `CodeNode:TypeScript:Property` | Class property |
| `CodeNode:TypeScript:Parameter` | Function parameter |
| `CodeNode:TypeScript:Import` | Import statement |
| `CodeNode:TypeScript:Enum` | Enum declaration |
| `CodeNode:TypeScript:Constructor` | Class constructor |
| `CodeNode:SourceFile:TypeScript` | A .ts file |
| `CodeNode:Entrypoint` | Framework registration (command, callback, event) |
| `Author` | Git author |
| `UnresolvedReference` | Import that couldn't be resolved to a graph node |

**Plan nodes** (standalone labels, not CodeNode subtypes):

| Label | What It Represents |
|-------|-------------------|
| `PlanProject` | Top-level plan project |
| `Milestone` | Plan milestone with spec text |
| `Sprint` | Time-boxed sprint |
| `Task` | Individual work item with status |
| `Decision` | Architectural decision record |

**Verification & governance nodes:**

| Label | What It Represents |
|-------|-------------------|
| `Project` | Top-level project with stats |
| `VerificationRun` | SARIF tool output (Semgrep, ESLint, done-check) |
| `AnalysisScope` | Scope of a verification run |
| `InfluencePath` | Transitive dependency path for explainability |
| `AdvisoryGateDecision` | Gate pass/fail decision |
| `PromotionDecision` | TC-8 promotion verdict |
| `GateDecision` | Legacy gate decision |
| `GovernanceMetricSnapshot` | Point-in-time governance metrics |
| `IntegritySnapshot` | Graph integrity snapshot |
| `MetricResult` | Single metric value |
| `MetricDefinition` | Metric definition |
| `ParserContract` | Parser regression contract |
| `InvariantProof` | Proof of invariant satisfaction |

**Claims & reasoning nodes:**

| Label | What It Represents |
|-------|-------------------|
| `Claim` | Domain-agnostic assertion with evidence |
| `Evidence` | Supporting/contradicting evidence for claims |
| `Hypothesis` | Auto-generated investigation target |

**Ground truth nodes:**

| Label | What It Represents |
|-------|-------------------|
| `SessionBookmark` | Agent session state (task, milestone, lease) |
| `IntegrityFindingDefinition` | Integrity check definition |
| `IntegrityFindingObservation` | Integrity check result |
| `Discrepancy` | Delta between expected and observed state |

**Hygiene governance nodes:**

| Label | What It Represents |
|-------|-------------------|
| `HygieneDomain` | Governance domain (foundation, topology, ownership) |
| `HygieneControl` | Individual hygiene control |
| `HygieneViolation` | Hygiene violation instance |
| `HygieneMetricSnapshot` | Hygiene metrics snapshot |

**IR nodes (intermediate representation):**

| Label | What It Represents |
|-------|-------------------|
| `IRNode:Entity` / `IRNode:Site` / `IRNode:Artifact` | Parser-agnostic IR nodes |
| `DocumentCollection` / `DocumentNode` / `DocumentWitness` | Document adapter nodes |

### Edge Types

**Code structure:**
`CALLS`, `CONTAINS`, `IMPORTS`, `RESOLVES_TO`, `HAS_PARAMETER`, `HAS_MEMBER`, `EXTENDS`, `IMPLEMENTS`, `REGISTERED_BY`, `READS_STATE`, `WRITES_STATE`, `POSSIBLE_CALL`, `ORIGINATES_IN`, `OWNED_BY`, `CO_CHANGES_WITH`

**Plans & governance:**
`PART_OF`, `DEPENDS_ON`, `HAS_CODE_EVIDENCE`, `TARGETS`, `BLOCKS`, `NEXT_STAGE`, `READS_PLAN_FIELD`, `MUTATES_TASK_FIELD`, `EMITS_NODE_TYPE`, `EMITS_EDGE_TYPE`

**Claims & reasoning:**
`SUPPORTED_BY`, `CONTRADICTED_BY`, `EXPLAINS_SUPPORT`, `EXPLAINS_CONTRADICTION`, `PROVES`, `REFERENCES`

**Verification & temporal confidence:**
`PRECEDES`, `HAS_SCOPE`, `ADJUDICATES`, `ADVISES_ON`, `MEASURED`, `MEASURED_BY`

**Governance provenance:**
`DERIVED_FROM_PROOF`, `DERIVED_FROM_RUN`, `DERIVED_FROM_COMMIT`, `DERIVED_FROM_GATE`, `AFFECTS_COMMIT`, `CAPTURED_COMMIT`, `CAPTURED_WORKTREE`, `EMITS_GATE_DECISION`, `BASED_ON_RUN`, `GENERATED_ARTIFACT`, `USED_BY`

**Ground truth:**
`OBSERVED_AS`, `PRODUCED`, `GENERATED_HYPOTHESIS`, `TRIGGERED_BY`

**Hygiene:**
`DEFINES_CONTROL`, `DEFINES_FAILURE_CLASS`, `DEFINES_PROFILE`, `DEFINES_TOPOLOGY`, `DEFINES_PROOF_SCOPE`, `TARGETS_FAILURE_CLASS`, `OWNS_SCOPE`, `APPLIES_TO`, `USES_SCHEMA_VERSION`, `MENTIONS`

### Key Properties

**On CodeNode (functions/methods):**
- `riskLevel` (float), `riskTier` (LOW/MEDIUM/HIGH/CRITICAL)
- `fanInCount`, `fanOutCount` — caller/callee counts
- `lineCount`, `isExported`, `sourceCode` (full source text)
- `kind` — Function, Method, Class, Variable, etc.
- `registrationKind`, `registrationTrigger` — framework handlers

**On SourceFile:**
- `gitChangeFrequency` (0.0–1.0), `authorEntropy`, `primaryAuthor`

**On CALLS edges:**
- `conditional`, `conditionalKind`, `isAsync`, `crossFile`, `resolutionKind`

**On VerificationRun:**
- `toolFamily`, `confidence`, `effectiveConfidence`, `temporalConfidenceFactor`

## MCP Tools (57)

### Core Analysis

| Tool | Purpose |
|------|---------|
| `pre_edit_check` | Gate. Call before editing any function. Returns verdict. |
| `simulate_edit` | Preview graph delta before applying changes |
| `impact_analysis` | Deep blast radius with transitive dependents |
| `search_codebase` | Semantic search via vector embeddings |
| `natural_language_to_cypher` | NL → Cypher conversion |
| `traverse_from_node` | Walk the graph from a node |
| `detect_dead_code` | Find unused exports |
| `detect_duplicate_code` | Find near-duplicates by normalized hash |
| `detect_hotspots` | Ranked risk × change frequency |
| `state_impact` | State field access patterns, race condition detection |
| `registration_map` | Framework entrypoint queries |

### Plan Tracking

| Tool | Purpose |
|------|---------|
| `plan_status` | Completion rates per project |
| `plan_drift` / `plan_gaps` / `plan_query` | Drift detection, gap analysis, free-form queries |
| `plan_priority` / `plan_next_tasks` | Dynamic priority ranking |

### Claims & Reasoning

| Tool | Purpose |
|------|---------|
| `claim_status` / `evidence_for` / `contradictions` / `hypotheses` | Claim lifecycle |
| `claim_generate` / `claim_chain_path` | Generation pipeline, cross-layer chain view |

### Governance & Verification

| Tool | Purpose |
|------|---------|
| `self_audit` | Generate questions, apply verdicts, detect drift |
| `verification_dashboard` | Unified trust/confidence overview |
| `confidence_debt_dashboard` | Track confidence debt |
| `import_sarif` | Import SARIF tool outputs |
| `commit_audit_status` | Latest commit audit result |
| `governance_metrics_status` | Governance observability snapshot |
| `parser_contract_status` | Parser regression checks |
| `recommendation_proof_status` | Recommendation truth-health |

### Session & Discovery

| Tool | Purpose |
|------|---------|
| `list_projects` / `parse_typescript_project` / `check_parse_status` | Project management |
| `start_watch_project` / `stop_watch_project` / `list_watchers` | File watching |
| `session_context_summary` | Cold-start context |
| `save_session_bookmark` / `restore_session_bookmark` | Session continuity |
| `save_session_note` / `recall_session_notes` / `cleanup_session` | Session notes |
| `test_neo4j_connection` / `hello` | Diagnostics |

### Ground Truth

| Tool | Purpose |
|------|---------|
| `ground_truth` | Three-panel integrity report: graph state, agent state, delta computation |

### Swarm Coordination (multi-agent)

`swarm_post_task`, `swarm_claim_task`, `swarm_complete_task`, `swarm_get_tasks`, `swarm_message`, `swarm_pheromone`, `swarm_sense`, `swarm_graph_refresh`, `swarm_cleanup`

## npm Scripts

126 scripts total. Key categories:

### Build & Dev

`build`, `dev`, `lint`, `format`, `test`, `mcp`

### Governance Pipeline (done-check — 57+ steps)

```bash
npm run done-check  # Full 69-step pipeline: build → enrich → verify → integrity → hygiene
```

Steps: `build` → `plan:refresh` → `edges:normalize` → `enrich:temporal-coupling` → `enrich:author-ownership` → `enrich:git-frequency` → `enrich:provenance` → `evidence:auto-link` → `plan:evidence:recompute` → ... → `integrity:verify`

### Enrichment (post-parse)

| Script | Trigger | What It Does |
|--------|---------|-------------|
| `enrich:possible-calls` | Watcher (post-parse) | POSSIBLE_CALL edges from dynamic dispatch |
| `enrich:state-edges` | Watcher (post-parse) | READS_STATE/WRITES_STATE from session access |
| `enrich:virtual-dispatch` | Watcher (post-parse) | Interface→implementation dispatch resolution |
| `enrich:unresolved-nodes` | Watcher (post-parse) | UnresolvedReference node creation |
| `enrich:temporal-coupling` | Done-check (step 4) | CO_CHANGES_WITH from git log |
| `enrich:author-ownership` | Done-check (step 5) | HAS_OWNER from git blame |
| `enrich:git-frequency` | Done-check (step 6) | gitChangeFrequency from commit counts |
| `enrich:provenance` | Done-check (step 7) | sourceKind/confidence on edges |

### Integrity & Verification

`integrity:snapshot`, `integrity:verify`, `integrity:snapshot:fields:verify`, `integrity:daily:job`

### Temporal Confidence (TC-1→TC-8)

`tc:recompute`, `tc:shadow`, `tc:debt`, `tc:anti-gaming`, `tc:explain`, `tc:calibrate`, `tc:promote`, `tc:verify`

### Registry & Edges

`registry:reconcile`, `registry:verify`, `registry:identity:verify`, `edges:normalize`, `edges:verify`

### Plans & Evidence

`plan:refresh`, `plan:deps:verify`, `plan:evidence:recompute`, `evidence:backfill`, `evidence:coverage`

### Hygiene Governance

`hygiene:foundation:sync/verify`, `hygiene:topology:sync/verify`, `hygiene:ownership:sync/verify`, `hygiene:exception:sync/verify`, `hygiene:proof:scope:sync`, `hygiene:proof:verify`

### Document Adapter

`doc:ingest`, `document:claims:grade/verify`, `document:namespace:reconcile/verify`, `document:witness:advisory`, `document:wording:verify`

### Ground Truth

`ground-truth`, `ground-truth:post-gate`

## Test Infrastructure

**1,052 tests, 73 suites** — all hermetic and deterministic.

### Test Harness Modules

| Module | What It Does |
|--------|-------------|
| `ephemeral-graph.ts` | projectId-isolated Neo4j runtime (`__test_<uuid>`) |
| `replay.ts` | Full hermetic env setup/teardown + replay from decision packets |
| `network-guard.ts` | Blocks `Socket.prototype.connect` — no network in tests |
| `snapshot-digest.ts` | SHA-256 determinism assertions |
| `structural-constraints.ts` | Graph structural integrity checks |
| `policy-bundle.ts` | Policy assembly, digest pinning, gate mode resolution |
| `gate-evaluator.ts` | Deterministic gate evaluation from immutable inputs |
| `pbt-runner.ts` | Property-based testing with stateful action sequences |
| `metamorphic.ts` | Query equivalence + semantics-preserving mutation checks |
| `mutation-library.ts` | Preserving/breaking mutations for metamorphic testing |
| `flake-governance.ts` | Auto-quarantine, reintegration, budget tracking |
| `ai-tevv.ts` | AI eval case runner with per-hazard thresholds |

### Fixture Tiers

- `fixtures/micro/` — 8 small deterministic fixtures (code-graph + plan-graph)
- `fixtures/scenario/` — 2 multi-step scenario fixtures
- `fixtures/sampled/` — Sampled production data (skeleton)
- `fixtures/stress/` — Large-scale stress fixtures (skeleton)

## Architecture

```
codegraph/
├── src/
│   ├── cli/                    # CLI (init, parse, enrich, serve, risk, analyze, status)
│   ├── core/
│   │   ├── parsers/            # TypeScript (ts-morph), Plan parser
│   │   ├── config/             # Schemas, invariants, change-class matrix
│   │   ├── claims/             # Claim engine (3 domain + 5 cross-layer synthesizers)
│   │   ├── embeddings/         # OpenAI embeddings + NL→Cypher
│   │   ├── ir/                 # Intermediate representation (v1 schema, materializer)
│   │   ├── adapters/document/  # Document parser
│   │   ├── ground-truth/       # Runtime, delta, packs, session bookmarks
│   │   ├── verification/       # Temporal confidence, advisory gate, SARIF import
│   │   └── test-harness/       # 12 hermetic test modules + fixtures
│   ├── mcp/
│   │   ├── tools/              # 44 tool files → 57 MCP tools
│   │   ├── handlers/           # Graph generation, traversal, incremental parse
│   │   └── services/           # Watch manager, job manager
│   ├── scripts/
│   │   ├── entry/              # Parse, ingest, watch entry points
│   │   ├── enrichment/         # 14 enrichment scripts
│   │   ├── tools/              # Edit simulation, reconciliation
│   │   └── verify/             # 16 verification scripts
│   ├── storage/neo4j/          # Neo4j driver + queries
│   └── utils/                  # 53 utility scripts
├── scripts/                    # Shell/Python helper scripts
├── artifacts/                  # Generated governance artifacts
├── docs/                       # Architecture docs, audit reports
├── skills/swarm/               # Multi-agent coordinator + worker protocols
├── AGENTS.md                   # Agent instructions for editing this codebase
├── WORKFLOW.md                  # Step-by-step task execution procedure
└── CLAUDE.md                   # Claude Code pointer → WORKFLOW.md + AGENTS.md
```

## Agent Workflows

- **Editing this codebase:** Read `AGENTS.md`
- **Editing any AnythingGraph-tracked project:** Read `WORKFLOW.md` (procedure) + `AGENTS.md` (reference)
- **Using Claude Code / ACP:** Read `CLAUDE.md`
- **Multi-agent refactoring:** Read `skills/swarm/COORDINATOR.md` + `skills/swarm/WORKER.md`

## Tech Stack

- **Parser:** ts-morph (semantic TypeScript — resolves types, not just syntax)
- **Graph:** Neo4j 5.x with APOC
- **MCP:** @modelcontextprotocol/sdk
- **Embeddings:** OpenAI text-embedding-3-large (optional)
- **NL→Cypher:** OpenAI gpt-4o (optional)
- **Tests:** Custom hermetic harness + Vitest
- **File watching:** @parcel/watcher (native inotify)
- **CLI:** commander

## What's Next

- **IR layer completion:** Parser → IR → Enrichment → Graph (decouple parsers from Neo4j)
- **Python parser:** CPython ast + Pyright sidecar — prove the architecture is language-agnostic
- **Document adapter:** Generic PDF/text ingestion via IR layer
- **Domain packs:** New domains implement `GroundTruthPack` interface and plug into the same graph
- **Done-check split:** Break the monolithic done-check into independent tools for TC-8 promotion

Full roadmap: `docs/MULTI_LANGUAGE_ASSESSMENT.md`

## License

MIT — Originally forked from [drewdrewH/code-graph-context](https://github.com/drewdrewH/code-graph-context) v2.9.0, substantially rewritten.
