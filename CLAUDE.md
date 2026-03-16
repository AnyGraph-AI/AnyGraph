# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**AnythingGraph** (repo: codegraph) is an MCP server that builds **universal reasoning graphs**. Give it any structured knowledge — code, documents, plans, corpora — and it parses, cross-references, generates claims, detects drift, and self-audits. Code parsing was the proof of concept. The architecture is the product.

**Current state**: ~16,500 nodes, ~25,000 edges, 8 projects, 56 MCP tools, 636 tests across 40 suites.

### Six Operational Layers
| Layer | Status | What It Does |
|-------|--------|-------------|
| **Code** | ✅ | TypeScript parsing, CALLS/RESOLVES_TO, risk scoring, blast radius |
| **Plans** | ✅ 6 projects | Task/Milestone/Sprint tracking, drift detection, cross-domain evidence |
| **Claims & Reasoning** | ✅ | Claims with evidence, hypotheses from gaps, self-audit |
| **Ground Truth** | ✅ | Agent-graph coordination: integrity checks, delta engine, session bookmarks |

### Key Design Principles
- **Parser → IR → Enrichment → Graph**: All parsers should output language-agnostic IR (IR layer exists but current TS parser writes Neo4j directly)
- **Three parser tiers**: Tier 0 (compiler-backed), Tier 1 (workspace-semantic), Tier 2 (structural/tree-sitter)
- **Four graph layers**: Evidence → Canonical → Operational → Agent Session
- **Multi-label nodes**: Code declarations are `CodeNode:TypeScript:Function` (not separate labels per kind)
- **Cross-layer synthesis**: Claims requiring 2+ layers to derive (code risk × plan impact, coverage gaps, temporal coupling)
- **Self-audit**: Graph generates verification questions, agents answer, graph updates itself
- **Hermetic testing**: Frozen clock, network guard, ephemeral graph, seeded RNG — all tests are deterministic

Full architecture plan: `docs/MULTI_LANGUAGE_ASSESSMENT.md`

## Build & Development Commands

```bash
npm run build          # Compile TypeScript to dist/
npm run dev            # Watch mode compilation
npm run mcp            # Run MCP server
npm run lint           # ESLint with auto-fix
npm run format         # Prettier formatting
npm test               # Run test suite
```

## Architecture

### Data Flow (Current — TypeScript)
```
TypeScript Project → AST Parser (ts-morph) → Graph Nodes/Edges → Neo4j + Vector Embeddings → MCP Tools
```

### Data Flow (Target — Universal)
```
Any Source → Language Parser → IR v1 → Enrichment Plugins → Neo4j → MCP Tools
```

### Key Directories

- `src/mcp/` — MCP server + 56 tools across code, plan, claim, swarm, governance, verification, ground truth, and session domains
- `src/core/parsers/` — TypeScript (ts-morph, ~1000 lines), Plan (~800 lines, v2.1), Python (scaffold)
- `src/core/claims/` — Claim engine (3 domain generators + 5 cross-layer synthesizers) + self-audit
- `src/core/config/` — Schema definitions, invariant registry (6 hard + 4 advisory), change-class matrix (5 classes, 7 lanes), eval lineage, gate decision packets, test provenance
- `src/core/ir/` — IR v1 schema, materializer, validator, enrichment plugins
- `src/core/adapters/document/` — Document parser, entity extractor, PDF extractor
- `src/core/verification/` — Advisory gate, exception enforcement
- `src/core/test-harness/` — 21 hermetic test modules (frozen clock, network guard, ephemeral graph, PBT runner, metamorphic testing, AI TEVV, provenance, confidence analytics) + fixture tiers (micro/scenario/sampled/stress)
- `src/core/embeddings/` — OpenAI embeddings + NL-to-Cypher
- `src/storage/neo4j/` — Neo4j driver and queries
- `src/scripts/entry/` — Parse, ingest, watch entry points
- `src/scripts/verify/` — 16 verification scripts
- `src/utils/` — 40+ utility scripts (governance, hygiene, evidence, verification)
- `src/cli/` — CLI with 7 commands (init, parse, enrich, serve, risk, analyze, status)

### Node Label Model

Code nodes use **multi-label**: `CodeNode:TypeScript:Function`, `CodeNode:TypeScript:Method`, etc. The `kind` property discriminates within the `CodeNode` label. Plan nodes are `CodeNode:Task`, `CodeNode:Milestone`, `CodeNode:Decision`.

Other node types: `Project`, `IntegritySnapshot`, `MetricResult`, `Claim`, `Evidence`, `Hypothesis`, `Verse`, `Chapter`, `Book`, `IRNode`.

### Multi-Project Support

All nodes carry `projectId`. Projects coexist in one Neo4j instance. Always filter by `projectId` in queries.

- **Code project**: `proj_c0d3e9a1f200` (CodeGraph self-graph)
- **Plan projects**: `plan_codegraph`, `plan_plan_graph`, `plan_runtime_graph`, `plan_governance_org`, `plan_hygiene_governance`, `plan_hygiene_ai`

### MCP Tools (56)

**Code Analysis (11):** `pre_edit_check`, `simulate_edit`, `impact_analysis`, `search_codebase`, `natural_language_to_cypher`, `traverse_from_node`, `detect_dead_code`, `detect_duplicate_code`, `detect_hotspots`, `state_impact`, `registration_map`

**Plan Tracking (6):** `plan_status`, `plan_drift`, `plan_gaps`, `plan_query`, `plan_priority`, `plan_next_tasks`

**Claims & Reasoning (6):** `claim_status`, `evidence_for`, `contradictions`, `hypotheses`, `claim_generate`, `claim_chain_path`

**Governance (5):** `self_audit`, `commit_audit_status`, `recommendation_proof_status`, `governance_metrics_status`, `parser_contract_status`

**Verification & Trust (4):** `verification_dashboard`, `explainability_paths`, `confidence_debt_dashboard`, `import_sarif`

**Ground Truth (1):** `ground_truth`

**Session (6):** `session_context_summary`, `save_session_bookmark`, `restore_session_bookmark`, `save_session_note`, `recall_session_notes`, `cleanup_session`

**Discovery (8):** `list_projects`, `parse_typescript_project`, `check_parse_status`, `start_watch_project`, `stop_watch_project`, `list_watchers`, `test_neo4j_connection`, `hello`

**Swarm (9):** `swarm_post_task`, `swarm_claim_task`, `swarm_complete_task`, `swarm_get_tasks`, `swarm_message`, `swarm_pheromone`, `swarm_sense`, `swarm_graph_refresh`, `swarm_cleanup`

### Response Format

All tools return JSON:API normalized responses:
- `nodes` map: Each node stored once, referenced by ID
- `depths` array: Relationship chains at each depth level
- Source code truncated to 1000 chars (first 500 + last 500)

### Compact Mode Parameters
| Parameter | Effect |
|-----------|--------|
| `includeCode: false` | Exclude source code |
| `summaryOnly: true` | File paths and stats only |
| `snippetLength: N` | Limit code to N chars |
| `maxTotalNodes: N` | Cap unique nodes |

## Dependencies

- **Neo4j 5.0+** — graph database
- **ts-morph** — TypeScript AST parsing
- **OpenAI API** — embeddings (text-embedding-3-large) + NL queries (optional)
- **@modelcontextprotocol/sdk** — MCP server
- **@parcel/watcher** — file watching
- **commander** — CLI
- **vitest** — test runner (+ custom hermetic harness)

## Environment Variables

```
OPENAI_API_KEY=required_for_embeddings
NEO4J_URI=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=codegraph
```

## Commit Convention

Conventional Commits: `type(scope): description`
- feat, fix, docs, style, refactor, perf, test, chore

## Operator Playbook

### Cold Start
1. `test_neo4j_connection`
2. `list_projects`
3. `plan_status` (all projects)
4. `plan_priority` → ranked work queue
5. `self_audit` summary

### Execute Safely
1. `pre_edit_check` before touching code
2. `simulate_edit` if verdict is SIMULATE_FIRST
3. Implement
4. `swarm_graph_refresh` / reparse

### Close
1. `plan_status` + `plan_drift` + `plan_priority`
2. Re-run claim generation if evidence changed
3. Run governance gate:

```bash
npm run done-check                    # standard
npm run done-check:strict:full        # strict (fail-closed)
```

### Failure Recovery
| Symptom | Fix |
|---------|-----|
| `PLAN_FRESHNESS_GUARD_FAILED` | `npm run plan:refresh`, retry |
| `invariant_proof_completeness` fail | `npm run verification:proof:record`, rerun |
| Drift alarms spike | Compare with baseline, apply allowlist if documented |
| Priority queue wrong | Check DEPENDS_ON edges, re-ingest plans, `plan:deps:verify` |

## Governance Integrity (Mandatory Before Closing Work)

```bash
npm run done-check                                    # standard gate
npm run done-check:strict:full                        # strict gate
VERIFICATION_CAPTURE_ALLOW_DIRTY=true npm run done-check:strict:full  # dev override
npm run commit:audit:verify -- <baseRef> <headRef>    # commit range audit
```

Threshold policy: strict by default. Temporary overrides must be documented in commit + plan task. Ratchet: once debt reduces, lower thresholds back.

### Key npm Script Categories

| Category | Scripts |
|----------|---------|
| **Build** | `build`, `dev`, `lint`, `format`, `test` |
| **Governance** | `done-check`, `done-check:strict:*`, `commit:audit:verify`, `governance:metrics:*`, `governance:stale:verify` |
| **Integrity** | `integrity:snapshot`, `integrity:verify`, `integrity:daily:job` |
| **Verification** | `verification:sarif:import`, `verification:scope:resolve`, `verification:exception:enforce`, `verification:advisory:gate`, `verification:done-check:capture`, `verification:proof:*` |
| **Registry** | `registry:reconcile`, `registry:verify`, `registry:backfill` |
| **Plans** | `plan:deps:verify`, `plan:refresh`, `plan:evidence:recompute`, `plan:embedding:match` |
| **Evidence** | `evidence:backfill`, `evidence:coverage` |
| **Hygiene** | `hygiene:foundation:*`, `hygiene:topology:*`, `hygiene:ownership:*`, `hygiene:exception:*`, `hygiene:proof:*` |
| **IR/Parser** | `ir:parity`, `parser:contracts:verify`, `parser:gold:harness` |
| **Document** | `doc:ingest`, `document:claims:*`, `document:namespace:*`, `document:witness:*` |
| **Claims** | `claims:cross:synthesize`, `claim_generate` (MCP) |

## Test Infrastructure

40 test suites, 636 tests. All hermetic (frozen clock, no network, ephemeral graph isolation).

**Semantic suites**: done-proven-status, status-resolver, waiver-expiry, verification-capture, freshness-guards, confidence-invariants, policy-replayability, stateful-pbt, metamorphic-suite, metamorphic-expanded, flake-governance, ai-tevv, provenance-hardening, confidence-analytics

**Infrastructure suites**: ephemeral-graph, network-guard, replay, snapshot-digest, structural-constraints, hermetic-env

Run all semantic tests:
```bash
for f in src/core/test-harness/__tests__/semantic/*.test.ts; do npx tsx "$f"; done
```
