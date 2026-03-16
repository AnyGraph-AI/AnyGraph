# AnythingGraph

A code intelligence graph that gives AI agents structural awareness before they edit. Parses TypeScript into Neo4j, tracks plan tasks with cross-domain evidence, detects drift, and self-audits. Agents query the graph to see blast radius, risk, dependencies, and what breaks.

**The thesis:** Understanding lives in connections, not individual files. A function's risk depends on who calls it, what plan tasks reference it, what state it mutates, and how often it changes. AnyGraph makes all of that queryable.

## Current State

- **~16,500 nodes, ~25,000 edges** across 8 projects (1 code + 6 plan + 1 document)
- **4 operational layers**: Code, Plans, Claims/Reasoning, Ground Truth
- **56 MCP tools** for agents to query, edit, and coordinate
- **636 hermetic tests** across 40 test suites
- **55-step governance pipeline** (done-check) with ground truth post-gate
- **v0.1.0** — TypeScript parser, temporal confidence, incremental recompute

### Projects in the Graph

| Domain | Projects | What's In Them |
|--------|----------|----------------|
| **Code** | CodeGraph (self-graph) | TypeScript AST → nodes/edges, risk scoring, blast radius |
| **Plans** | codegraph, plan-graph, runtime-graph, governance-org, hygiene-governance, hygiene-ai | Task/Milestone/Sprint tracking, auto-completion detection |
| **Claims** | Claims, evidence, hypotheses | Cross-layer synthesis, self-audit verdicts |

## Quick Start

### Prerequisites
- Node.js 22+
- Neo4j 5.x (native install, not Docker)
- `npm install` in this directory

### Start Neo4j
```bash
sudo neo4j start
```
Auth: `neo4j` / `codegraph` — `bolt://localhost:7687`

### Parse a TypeScript project
```bash
# Parse and ingest to Neo4j
npx tsx src/scripts/entry/parse-and-ingest.ts

# Parse CodeGraph itself (self-graph)
npx tsx src/scripts/entry/parse-and-ingest-self.ts

# Run 17-step post-ingest enrichment
bash post-ingest-all.sh
```

### Query the graph
```bash
# List all projects
cypher-shell -u neo4j -p codegraph "MATCH (p:Project) RETURN p.name, p.projectId, p.nodeCount, p.edgeCount"

# Find riskiest functions
cypher-shell -u neo4j -p codegraph "MATCH (f:CodeNode {projectId: 'proj_c0d3e9a1f200'}) WHERE f.riskTier IN ['CRITICAL', 'HIGH'] RETURN f.name, f.riskTier, f.kind ORDER BY f.riskLevel DESC LIMIT 10"
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

## Graph Schema

### Node Label Model

Code nodes use a **multi-label model**: every code declaration is a `CodeNode` with additional labels for language (`TypeScript`) and kind (`Function`, `Method`, `Class`, etc.). The `kind` property provides the discriminator.

| Label Pattern | What It Represents |
|--------------|-------------------|
| `CodeNode:TypeScript:Function` | Named function |
| `CodeNode:TypeScript:Method` | Class method |
| `CodeNode:TypeScript:Class` | Class declaration |
| `CodeNode:TypeScript:Interface` | Interface declaration |
| `CodeNode:TypeScript:Variable` | const/let/var |
| `CodeNode:TypeScript:TypeAlias` | `type X = ...` |
| `CodeNode:TypeScript:Property` | Class property |
| `CodeNode:TypeScript:Parameter` | Function parameter |
| `CodeNode:TypeScript:Import` | Import statement |
| `CodeNode:TypeScript:Enum` | Enum declaration |
| `CodeNode:TypeScript:Constructor` | Class constructor |
| `CodeNode:SourceFile:TypeScript` | A `.ts` file |
| `CodeNode:Entrypoint` | Framework registration (command, callback, event) |
| `CodeNode:Task` | Plan task node |
| `CodeNode:Milestone` | Plan milestone node |
| `CodeNode:Decision` | Plan decision node |
| `CodeNode:VerificationRun` | Governance verification run |
| `CodeNode:GateDecision` | Gate pass/fail decision |
| `CodeNode:GovernanceMetricSnapshot` | Governance metrics snapshot |
| `Project` | Top-level project with stats |
| `IntegritySnapshot` | Graph integrity snapshot |
| `MetricResult` | Single metric value |
| `Claim` | Domain-agnostic assertion with evidence |
| `Hypothesis` | Auto-generated investigation target |
| `Evidence` | Supporting/contradicting evidence for claims |
| `Verse` / `Chapter` / `Book` | Corpus text nodes (when corpus domain loaded) |
| `IRNode:Entity` / `IRNode:Site` / `IRNode:Artifact` | Intermediate representation nodes |
| `IntegrityFindingObservation` | Ground truth integrity check result |
| `Discrepancy` | Delta between expected and observed state |

### Edge Types

**Code structure:**
`CALLS`, `CONTAINS`, `IMPORTS`, `RESOLVES_TO`, `HAS_PARAMETER`, `HAS_MEMBER`, `REGISTERED_BY`, `READS_STATE`, `WRITES_STATE`, `POSSIBLE_CALL`, `EXTENDS`, `IMPLEMENTS`, `ORIGINATES_IN`, `OWNED_BY`, `BELONGS_TO_LAYER`, `DECLARES`

**Plans & governance:**
`PART_OF`, `DEPENDS_ON`, `HAS_CODE_EVIDENCE`, `TARGETS`, `BLOCKS`, `NEXT_STAGE`, `READS_PLAN_FIELD`, `MUTATES_TASK_FIELD`, `EMITS_NODE_TYPE`, `EMITS_EDGE_TYPE`

**Claims & reasoning:**
`SUPPORTED_BY`, `CONTRADICTED_BY`, `WITNESSES`, `PROVES`, `ANCHORS`

**Governance provenance:**
`MEASURED`, `DERIVED_FROM_PROOF`, `DERIVED_FROM_RUN`, `DERIVED_FROM_COMMIT`, `DERIVED_FROM_GATE`, `AFFECTS_COMMIT`, `CAPTURED_COMMIT`, `CAPTURED_WORKTREE`, `EMITS_GATE_DECISION`, `BASED_ON_RUN`, `GENERATED_ARTIFACT`, `USED_BY`

**Ground Truth Hook:**
`OBSERVED_AS`, `PRODUCED`, `GENERATED_HYPOTHESIS`, `BECAME_TASK`, `RESOLVED_BY_COMMIT`, `PRECEDES`

### Key Properties

**On CodeNode (functions/methods):**
- `riskLevel` (float), `riskTier` (LOW/MEDIUM/HIGH/CRITICAL)
- `fanInCount`, `fanOutCount` — caller/callee counts
- `lineCount`, `isExported`, `sourceCode` (full source text)
- `kind` — Function, Method, Class, Variable, etc.
- `registrationKind`, `registrationTrigger` — framework handlers

**On SourceFile:**
- `gitChangeFrequency` (0.0-1.0), `authorEntropy`, `primaryAuthor`, `architectureLayer`

**On CALLS edges:**
- `conditional`, `conditionalKind`, `isAsync`, `crossFile`, `resolutionKind`

## MCP Tools (56)

### Core Analysis
| Tool | Purpose |
|------|---------|
| `pre_edit_check` | **Gate.** Call before editing any function. Returns verdict. |
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
| `commit_audit_status` | Latest commit audit result |
| `recommendation_proof_status` | Recommendation truth-health |
| `governance_metrics_status` | Governance observability snapshot |
| `parser_contract_status` | Parser regression checks |
| `verification_dashboard` | Unified trust/confidence overview |
| `confidence_debt_dashboard` | Track confidence debt |
| `import_sarif` | Import SARIF tool outputs |

### Session & Discovery
| Tool | Purpose |
|------|---------|
| `list_projects` / `parse_typescript_project` / `check_parse_status` | Project management |
| `start_watch_project` / `stop_watch_project` / `list_watchers` | File watching |
| `session_context_summary` | Cold-start context |
| `save_session_bookmark` / `restore_session_bookmark` | Session continuity |
| `save_session_note` / `recall_session_notes` / `cleanup_session` | Session notes |
| `test_neo4j_connection` / `hello` | Diagnostics |

### Ground Truth Hook
| Tool | Purpose |
|------|---------|
| `ground_truth` | Three-panel integrity report: graph state, agent state, delta computation |

### Swarm Coordination (multi-agent)
`swarm_post_task`, `swarm_claim_task`, `swarm_complete_task`, `swarm_get_tasks`, `swarm_message`, `swarm_pheromone`, `swarm_sense`, `swarm_graph_refresh`, `swarm_cleanup`

## npm Scripts (Categorized)

### Build & Dev
`build`, `dev`, `lint`, `format`, `test`, `prepare`, `prepublishOnly`

### Governance (done-check pipeline)
`done-check`, `done-check:strict:smoke`, `done-check:strict:full`, `commit:audit:verify`, `governance:metrics:snapshot`, `governance:metrics:report`, `governance:metrics:integrity:verify`, `governance:stale:verify`, `governance:attribution:backfill`, `governance:metric:def:sync`, `governance:metric:def:verify`

### Integrity & Verification
`integrity:snapshot`, `integrity:verify`, `integrity:snapshot:fields:verify`, `integrity:daily:job`, `verification:sarif:import`, `verification:scope:resolve`, `verification:exception:enforce`, `verification:advisory:gate`, `verification:done-check:capture`, `verification:done-check:capture:only`, `verification:proof:record`, `verification:proof:status`, `verification:status:dashboard`, `verification:recommendation:mismatch`, `verification:pilot:ir:validate`, `verification:pilot:vg5:thresholds`, `verification:ingest`

### Registry & Edges
`registry:reconcile`, `registry:verify`, `registry:backfill`, `registry:duplicates:report`, `registry:identity:verify`, `edges:normalize`, `edges:verify`

### Plans & Evidence
`plan:deps:verify`, `plan:refresh`, `plan:evidence:recompute`, `plan:embedding:match`, `evidence:backfill`, `evidence:coverage`

### Claims & Embeddings
`claims:cross:synthesize`, `code:embedding-inputs:enrich`, `embedding:fp:verify`

### Document Adapter
`doc:ingest`, `document:claims:grade`, `document:claims:verify`, `document:evidence:link-runtime`, `document:namespace:audit`, `document:namespace:reconcile`, `document:namespace:verify`, `document:witness:advisory`, `document:wording:verify`

### Hygiene Governance
`hygiene:foundation:sync`, `hygiene:foundation:verify`, `hygiene:topology:sync`, `hygiene:topology:verify`, `hygiene:ownership:sync`, `hygiene:ownership:verify`, `hygiene:exception:sync`, `hygiene:exception:verify`, `hygiene:platform:verify`, `hygiene:proof:scope:sync`, `hygiene:proof:verify`, `hygiene:deps:sync`

### IR & Parser
`ir:parity`, `ir:parity:resume`, `parser:contracts:verify`, `parser:gold:harness`, `python:parse:ir`, `query:contract:verify`

### Ground Truth
`ground-truth`, `ground-truth:post-gate`

### Audit
`audit:anchor:resolve`

### MCP Server
`mcp`

## Test Infrastructure

### TDD Harness (328 tests, 29 suites)

The test harness provides hermetic, deterministic testing for all governance surfaces:

| Module | What It Does |
|--------|-------------|
| `frozen-clock.ts` | Deterministic `Date.now()` via monkey-patch |
| `frozen-locale.ts` | Deterministic locale/timezone |
| `seeded-rng.ts` | Seeded xorshift128+ PRNG |
| `network-guard.ts` | Blocks `Socket.prototype.connect` — no network in tests |
| `ephemeral-graph.ts` | projectId-isolated Neo4j runtime (`__test_<uuid>`) |
| `replay.ts` | Full hermetic env setup/teardown + replay from decision packets |
| `snapshot-digest.ts` | SHA-256 determinism assertions |
| `structural-constraints.ts` | Graph structural integrity checks |
| `migration-contracts.ts` | Migration contract verification |
| `structural-drift.ts` | Structural drift guards |
| `policy-bundle.ts` | Policy assembly, digest pinning, gate mode resolution |
| `gate-evaluator.ts` | Deterministic gate evaluation from immutable inputs |
| `pbt-runner.ts` | Property-based testing with stateful action sequences |
| `metamorphic.ts` | Query equivalence + semantics-preserving mutation checks |
| `mutation-library.ts` | Preserving/breaking mutations for metamorphic testing |
| `flake-governance.ts` | Auto-quarantine, reintegration, budget tracking |
| `ai-tevv.ts` | AI eval case runner with per-hazard thresholds + lineage-gated promotion |
| `provenance-hardening.ts` | SLSA-shaped provenance envelopes with fail-closed policy |
| `confidence-analytics.ts` | Regression budgets, completeness trends, override entropy, policy effectiveness |

### Fixture Tiers
- `fixtures/micro/` — 8 small deterministic fixtures (code-graph + plan-graph)
- `fixtures/scenario/` — 2 multi-step scenario fixtures
- `fixtures/sampled/` — Sampled production data (skeleton)
- `fixtures/stress/` — Large-scale stress fixtures (skeleton)

## Operational Layers

| Layer | Status | What It Does |
|-------|--------|-------------|
| **Code** | ✅ | TypeScript parsing, CALLS/RESOLVES_TO, risk scoring, blast radius |
| **Plans** | ✅ | Task/Milestone tracking, drift detection, cross-domain evidence |
| **Claims & Reasoning** | ✅ | Claims with evidence, hypotheses from gaps, self-audit |
| **Ground Truth** | ✅ | Agent-graph coordination: integrity checks, delta engine, session bookmarks |

## Architecture

```
codegraph/
├── src/
│   ├── cli/                  # CLI (init, parse, enrich, serve, risk, analyze, status)
│   ├── core/
│   │   ├── parsers/          # TypeScript (ts-morph), Plan
│   │   ├── config/           # Schemas, invariants, change-class matrix, eval lineage
│   │   ├── claims/           # Claim engine (3 domain + 5 cross-layer synthesizers)
│   │   ├── embeddings/       # OpenAI embeddings + NL→Cypher
│   │   ├── ir/               # Intermediate representation (v1 schema, materializer, validator)
│   │   ├── adapters/document/ # Document parser (scaffold)
│   │   ├── ground-truth/     # Ground Truth Hook: runtime, delta, packs, session bookmarks
│   │   ├── verification/     # Advisory gate, exception enforcement, temporal confidence
│   │   ├── test-harness/     # 20 hermetic test modules + fixtures
│   │   └── utils/            # File detection, graph factory, path utils
│   ├── mcp/
│   │   ├── tools/            # 40 MCP tools
│   │   ├── handlers/         # Graph generation, traversal, incremental parse
│   │   └── services/         # Watch manager, job manager
│   ├── scripts/
│   │   ├── entry/            # Parse, ingest, watch entry points
│   │   ├── tools/            # Edit simulation, reconciliation, embedding
│   │   └── verify/           # 16 verification scripts
│   ├── storage/neo4j/        # Neo4j driver + queries
│   └── utils/                # 40+ utility scripts (governance, hygiene, evidence, verification)
├── swarm/                    # Multi-agent coordinator + worker protocols
├── plans/                    # Plan files (codegraph, godspeed, bible-graph, etc.)
├── fixtures/                 # Test fixtures (micro, scenario, sampled, stress)
├── artifacts/                # Generated governance artifacts (snapshots, metrics)
├── docs/                     # Governance rollout, Python scaffolding, audit standards
├── AGENTS.md                 # Agent instructions for editing CodeGraph
├── SKILL.md                  # Universal agent skill for any project
├── CLAUDE.md                 # Claude Code / ACP agent instructions
└── .codegraph.yml            # Project config (framework, state roots, risk)
```

## Agent Workflows

- **Editing this codebase**: Read `AGENTS.md`
- **Editing any CodeGraph-tracked project**: Read `SKILL.md`
- **Using Claude Code / ACP**: Read `CLAUDE.md`
- **Multi-agent refactoring**: Read `swarm/COORDINATOR.md` + `swarm/WORKER.md`

## Tech Stack

- **Parser**: ts-morph (semantic TypeScript — resolves types, not just syntax)
- **Graph**: Neo4j 5.x (same architecture as GOYFILES investigation graph)
- **MCP**: @modelcontextprotocol/sdk
- **Embeddings**: OpenAI text-embedding-3-large (optional)
- **NL→Cypher**: OpenAI gpt-4o (optional)
- **Tests**: Custom hermetic harness (334 tests, 30 suites) + Vitest
- **File watching**: @parcel/watcher (native inotify)
- **CLI**: commander

## What's Next

1. **Second language parser**: Python (CPython ast + Pyright) or Go — prove the architecture is language-agnostic
2. **IR layer**: Parser → IR → Enrichment → Graph (decouple parsers from Neo4j)
3. **Temporal Confidence (TC-3→TC-8)**: Shadow propagation, explainability, confidence debt — when a second domain needs it
4. **Domain packs**: New domains implement GroundTruthPack interface and plug into the same graph

Full roadmap: `plans/codegraph/MULTI_LANGUAGE_ASSESSMENT.md`

## License

v0.1.0 — Originally forked from drewdrewH/code-graph-context v2.9.0, substantially rewritten
