# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**AnythingGraph** (repo: codegraph) is an MCP server that builds **universal reasoning graphs**. Give it any structured knowledge — code, documents, plans, corpora — and it parses, cross-references, generates claims, detects drift, and self-audits. Code parsing was the proof of concept. The architecture is the product.

**Current state**: 50,972 nodes, 555,014 edges, 12 projects, 45 MCP tools.

### Six Operational Layers
| Layer | Status | What It Does |
|-------|--------|-------------|
| **Code** | ✅ 3 projects | TypeScript parsing, CALLS/RESOLVES_TO, risk scoring, blast radius |
| **Corpus** | ✅ 5 projects | Bible + Quran + Deuterocanon + Pseudepigrapha + Early Contested, entity resolution |
| **Documents** | ❌ Not built | Generic PDF/text ingestion pipeline (next milestone) |
| **Plans** | ✅ 4 projects | Task/Milestone/Sprint tracking, drift detection, cross-domain evidence |
| **Claims** | ✅ 346 claims | Domain-agnostic assertions with evidence grades + confidence aggregation |
| **Reasoning** | ✅ 233 hypotheses | Auto-generated from evidence gaps, cross-layer synthesis, self-audit |

### Key Design Principles
- **Parser → IR → Enrichment → Graph**: All parsers should output language-agnostic IR (IR layer not yet built — current TS parser writes Neo4j directly)
- **Three parser tiers**: Tier 0 (compiler-backed), Tier 1 (workspace-semantic), Tier 2 (structural/tree-sitter)
- **Four graph layers**: Evidence → Canonical → Operational → Agent Session
- **Confidence-aware risk**: Edge weights carry parser tier + confidence, risk engine degrades gracefully on structural-only areas
- **Cross-layer synthesis**: Claims that require 2+ layers to derive (code risk × plan impact, coverage gaps, temporal coupling, entity centrality)
- **Self-audit**: Graph generates verification questions, agents answer, graph updates itself

Full architecture plan: `plans/codegraph/MULTI_LANGUAGE_ASSESSMENT.md` (title: "Universal Reasoning Graph — Architecture & Roadmap")

## Build & Development Commands

```bash
npm run build          # Compile TypeScript to dist/
npm run dev            # Watch mode compilation
npm run mcp            # Run MCP server: node dist/mcp/mcp.server.js
npm run lint           # ESLint with auto-fix
npm run format         # Prettier formatting
```

## Architecture

### Data Flow (Current — TypeScript)
```
TypeScript Project → AST Parser (ts-morph) → Graph Nodes/Edges → Neo4j + Vector Embeddings → MCP Tools
```

### Data Flow (Target — Universal)
```
Any Source → Language Parser → IR v1 → Enrichment Plugins → Neo4j → MCP Tools (43 tools)
```

### Key Directories

- `src/mcp/` - MCP server entry point and tools
  - `mcp.server.ts` - Server initialization
  - `tools/` - 45 MCP tools across code, plan, claim, swarm, and self-audit domains
  - `handlers/` - Business logic for graph generation and traversal
- `src/core/` - Core business logic
  - `parsers/typescript-parser.ts` - TypeScript AST parser (~1000 lines)
  - `parsers/plan-parser.ts` - Plan file parser (~800 lines, v2.1)
  - `claims/claim-engine.ts` - Claim generation + 5 cross-layer synthesizers
  - `claims/self-audit.ts` - Self-audit engine (questions → verdicts → graph updates)
  - `config/schema.ts` - Core graph schema definitions
  - `config/nestjs-framework-schema.ts` - NestJS semantic patterns
  - `embeddings/` - OpenAI embeddings and NL-to-Cypher services
- `src/storage/neo4j/` - Neo4j driver and queries

### Dual-Schema System

The parser uses two schema layers:
1. **Core Schema** (AST-level): ClassDeclaration, MethodDeclaration, PropertyDeclaration, ImportDeclaration, etc.
2. **Framework Schema** (Semantic): Controller, Service, Module, Guard, Repository, etc. (NestJS patterns)

Nodes have both `coreType` (AST) and `semanticType` (framework interpretation).

### Multi-Project Support

The system supports multiple projects in a single Neo4j database through project isolation:

- **Project ID Format**: `proj_<12-hex-chars>` (e.g., `proj_a1b2c3d4e5f6`)
- **Auto-generation**: If not provided, projectId is generated deterministically from the project path
- **Explicit Override**: Pass `projectId` to `parse_typescript_project` to use a custom ID
- **Isolation**: All queries are automatically scoped to the project - nodes from different projects never interfere

**Usage in Tools:**
```typescript
// All query tools require projectId
search_codebase({ projectId: "proj_abc123...", query: "..." })
traverse_from_node({ projectId: "proj_abc123...", nodeId: "..." })
impact_analysis({ projectId: "proj_abc123...", nodeId: "..." })

// parse_typescript_project returns the resolved projectId
const result = await parse_typescript_project({ projectPath: "/path/to/project" });
// result.resolvedProjectId => "proj_a1b2c3d4e5f6"
```

### Migration from Pre-Multi-Project Versions

If upgrading from a version without multi-project support, note these breaking changes:

**Breaking Changes:**
- Node IDs now include projectId prefix (format: `proj_xxx:CoreType:hash`)
- All query tools now require `projectId` parameter
- Existing nodes in the database have old ID format and won't be accessible

**Migration Options:**

1. **Clear and Re-parse (Recommended)**
   ```bash
   # Clear the database and re-parse your project
   # The new projectId will be auto-generated from the project path
   ```

2. **Continue Without Multi-Project**
   - Not recommended - existing node IDs are incompatible
   - Queries will fail to find nodes with old ID format

**Note:** There is no automatic migration path. Existing graphs must be rebuilt to use the new ID format with projectId isolation.

### MCP Tools (44 total)

**Code Analysis:**
| Tool | Purpose |
|------|---------|
| `pre_edit_check` | **ALWAYS call before editing.** Returns verdict + callers + state + coupling |
| `simulate_edit` | Full graph delta preview before applying changes |
| `impact_analysis` | Deep blast radius with transitive dependents and risk scoring |
| `search_codebase` | Semantic search via vector embeddings |
| `traverse_from_node` | Explore relationships from a node ID |
| `natural_language_to_cypher` | Convert NL to Cypher queries |
| `state_impact` | State field access patterns, race condition detection |
| `registration_map` | Framework entrypoint queries |
| `detect_hotspots` | Ranked risk × change frequency |
| `detect_dead_code` | Find unused exports |
| `detect_duplicate_code` | Find near-duplicates by normalized hash |

**Plan Tracking:**
| Tool | Purpose |
|------|---------|
| `plan_status` | Completion rates per project (done/planned/drift) |
| `plan_drift` | Tasks with code evidence but unchecked boxes |
| `plan_gaps` | Planned tasks with zero evidence |
| `plan_query` | Free-form plan graph queries |
| `plan_priority` | Dynamic priority ranking — "what should I build next?" |

**Claims & Reasoning:**
| Tool | Purpose |
|------|---------|
| `claim_status` | Overview of claims by domain and status |
| `evidence_for` | Evidence supporting/contradicting a specific claim |
| `contradictions` | Find contested or contradicted claims |
| `hypotheses` | Auto-generated investigation targets from gaps |
| `claim_generate` | Run claim generation pipeline |

**Self-Audit:**
| Tool | Purpose |
|------|---------|
| `self_audit` | Summary / generate questions / apply verdicts |

**Swarm (8 tools):** `swarm_post_task`, `swarm_claim_task`, `swarm_complete_task`, `swarm_get_tasks`, `swarm_message`, `swarm_pheromone`, `swarm_sense`, `swarm_graph_refresh`

**Utility:** `parse_typescript_project`, `test_neo4j_connection`, `list_projects`, `save_session_bookmark`, `restore_session_bookmark`, `save_session_note`, `recall_session_notes`

### Response Format

All tools return JSON:API normalized responses:
- `nodes` map: Each node stored once, referenced by ID
- `depths` array: Relationship chains at each depth level
- Source code truncated to 1000 chars (first 500 + last 500)

### Response Size Control (Compact Mode)

All query tools support parameters to reduce response size for exploration:

| Parameter | Tools | Effect |
|-----------|-------|--------|
| `includeCode: false` | search_codebase, traverse_from_node | Exclude source code (names/paths only) |
| `summaryOnly: true` | traverse_from_node | Return only file paths and statistics |
| `snippetLength: N` | search_codebase, traverse_from_node | Limit code snippets to N characters |
| `maxTotalNodes: N` | traverse_from_node | Cap total unique nodes returned |
| `maxNodesPerChain: N` | both | Limit relationship chains per depth |

**Recommended usage patterns:**
```typescript
// Structure overview - just names/paths, no source code
search_codebase({ projectId: "...", query: "...", includeCode: false })

// Quick summary - file paths and statistics only
traverse_from_node({ projectId: "...", nodeId: "...", summaryOnly: true })

// Detailed with smaller snippets
traverse_from_node({ projectId: "...", nodeId: "...", snippetLength: 200 })

// Minimal output for large graphs
traverse_from_node({ projectId: "...", nodeId: "...", includeCode: false, maxNodesPerChain: 3 })
```

## Dependencies

- **Neo4j 5.0+** with APOC plugin required
- **OpenAI API** for embeddings (text-embedding-3-large) and NL queries
- **ts-morph** for TypeScript AST parsing

## Environment Variables

```
OPENAI_API_KEY=required
NEO4J_URI=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=PASSWORD
```

## Commit Convention

Conventional Commits: `type(scope): description`
- feat, fix, docs, style, refactor, perf, test, chore

## Operator Playbook (End-to-End)

Use this sequence when running AnythingGraph as a production system, not just a code parser.

### 0) Cold Start (5-10 min)
1. `test_neo4j_connection`
2. `list_projects`
3. `plan_status` (all projects)
4. `plan_priority` (global, then `projectFilter: "codegraph"`)
5. `self_audit` summary (identify unaudited drift)

**Output:** a ranked work queue, current drift count, and blocked milestones.

### 1) Intake / Ingest
- Plan changes: re-run plan ingest (`plan-parser.ts ... --ingest`) or let watcher ingest.
- Code changes: parse project or run watcher refresh.
- Documents/corpus: ingest through adapter pipeline (when M2 ships).

**Definition of done:** graph nodes/edges updated, project stats changed, no parser errors.

### 2) Reconcile Reality vs Plan
1. `plan_drift` for target project
2. `self_audit` generate questions
3. Apply verdicts (`CONFIRMED`, `FALSE_POSITIVE`, `PARTIAL`)
4. Update plan checkboxes when confirmed

**Definition of done:** drift is either resolved or explicitly audited with verdict metadata.

### 3) Prioritize
- Run `plan_priority`.
- Pick highest-scoring tasks first (most downstream unblock).
- If tie: prefer tasks with `hasCodeEvidence=true` (fast closure).

### 4) Execute Safely
Before touching code:
1. `pre_edit_check`
2. if needed, `simulate_edit`
3. implement
4. `swarm_graph_refresh` / reparse

### 5) Verify + Close
- Re-run: `plan_status`, `plan_drift`, `plan_priority`
- Re-run claim generation if evidence changed materially.
- Commit docs + plan updates with code.

---

## Failure & Recovery Playbooks

### Watcher stale / not reflecting changes
- Run manual parse/ingest for affected project.
- Validate via `list_projects` node/edge deltas.

### Drift explosion (many false positives)
- Run `self_audit` on that project.
- Mark `FALSE_POSITIVE` to suppress repeated noise.
- Tighten matching thresholds if needed.

### Claims look like mirrors (low synthesis value)
- Prioritize cross-layer synthesizers over single-layer generators.
- Ensure evidence links exist across plan↔code↔corpus/document.

### Priority queue looks wrong
- Check `BLOCKS`/`DEPENDS_ON` graph edges exist for milestones/tasks.
- For ordered tracks (`DL-*`, `GM-*`), ensure every non-starter task has task-level `DEPENDS_ON`.
- If a task must be dependency-free, annotate `NO_DEPENDS_OK(reason|expires:YYYY-MM-DD)`.
- Re-ingest plans and run `plan:deps:verify` before trusting priority/ranking output.

---

## Project-Agnostic Query Rule
All plan queries are project-agnostic by default. Scope with `projectFilter` when needed.
Examples: `codegraph`, `godspeed`, `bible-graph`, `plan-graph`.

## Governance Integrity Runbook (Operator Mandatory)
Before closing work, run:

```bash
npm run done-check
```

Supporting commands:

```bash
npm run edges:normalize
npm run plan:evidence:recompute
npm run registry:reconcile
npm run registry:verify
npm run edges:verify
npm run parser:contracts:verify
npm run plan:deps:verify
npm run integrity:snapshot
npm run integrity:verify
```

Scoped dependency enforcement:
- `plan:deps:verify` reports scoped dependency hygiene metrics.
- Use `STRICT_SCOPED_DEPENDS_ON=true` to fail-closed when scoped tasks are missing required task-level dependencies.
- Strict governance rollouts:
  - `npm run done-check:strict:smoke`
  - `npm run done-check:strict:full`
- Runbook: `docs/GOVERNANCE_STRICT_ROLLOUT.md`

Threshold policy:
- Default policy is strict (fail on violations over configured limits).
- Temporary threshold increases are allowed only as explicit transition controls while paying down known debt.
- Any threshold override must be documented in commit message and linked plan task.
- Ratchet policy: once debt is reduced, lower thresholds back to strict defaults.

Do not announce “done” when `done-check` is red.

### IR Parity Gate (for IR-path changes)
When parser/IR/materializer code changes, run parity as a second gate:

```bash
npm run ir:parity
```

Resume controls:
- `npm run ir:parity:resume`
- `npm run ir:parity -- --force-target=<name>`
- `npm run ir:parity -- --fresh`

### Verification Pipeline Commands
Recommendation freshness rule: run plan re-ingest before recommendation tools (`plan_priority`, `plan_next_tasks`) if plan markdown changed. Freshness guard now blocks stale reads unless `allowStale=true`.

```bash
# Import SARIF findings
npm run verification:sarif:import -- <projectId> <sarifPath>

# Scope-aware resolver (downgrade clean runs, enforce UNKNOWN_FOR, detect contradictions)
npm run verification:scope:resolve -- <projectId>

# Exception enforcement (waiver policy, truth/gate separation)
npm run verification:exception:enforce -- <projectId>

# Advisory gate (decision logs + replayability hashes)
npm run verification:advisory:gate -- <projectId> [policyBundleId]

# Runtime truth capture (done-check + git state + decision/artifact hashes into graph)
npm run verification:done-check:capture -- [projectId] [policyBundleId]

# Commit audit (invariants over a commit range)
npm run commit:audit:verify -- <baseRef> <headRef>
```

MCP status tools relevant to this pipeline:
- `commit_audit_status` — latest commit audit summary
- `recommendation_proof_status` — recommendation truth-health (`freshness`, `done_vs_proven`, `mismatch_rate`)
- `governance_metrics_status` — latest/trend governance observability (`verificationRuns`, `gateFailures`, `interceptionRate`, `regressionsAfterMerge`)
