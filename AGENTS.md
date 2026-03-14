# AnythingGraph — Agent Instructions

## What This Is

AnythingGraph (repo: codegraph) is a **universal reasoning graph**. It ingests code, plans, corpora, and documents into Neo4j, cross-references across domains, generates claims with evidence, detects drift, and self-audits. Code parsing was the proof of concept — the architecture handles any structured knowledge.

**Current state**: 63,000+ nodes, 415,000+ edges, 22 projects, 39 MCP tools, 132+ hermetic tests, and 6 operational layers.

**Six layers**: Code (3 projects) → Corpus (5 projects) → Plans (8 projects) → Claims (414) → Reasoning (52 hypotheses) → Self-Audit.

Every function, task, verse, claim, and entity is a node. Every call, evidence link, mention, and dependency is an edge.
**Query the graph before you edit. That's the entire point.**

---

## Connection

```bash
cypher-shell -u neo4j -p codegraph "YOUR CYPHER QUERY"
```
- URI: `bolt://localhost:7687`
- Browser: `http://localhost:7474`
- Auth: `neo4j` / `codegraph`
- APOC plugin installed (416 functions)
- Vector index: `embedded_nodes_idx` (cosine, 3072 dims)

---

## Graph Schema

### Node Label Model

Code nodes use **multi-label**: `CodeNode:TypeScript:Function`, `CodeNode:TypeScript:Method`, etc. The `kind` property on `CodeNode` provides the discriminator.

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
| `CodeNode:Task` / `CodeNode:Milestone` / `CodeNode:Decision` | Plan nodes |
| `CodeNode:VerificationRun` / `CodeNode:GateDecision` | Governance nodes |
| `CodeNode:GovernanceMetricSnapshot` / `CodeNode:MetricSurface` | Metrics nodes |
| `Project` | Top-level project with stats |
| `IntegritySnapshot` / `MetricResult` | Integrity tracking |
| `Claim` / `Evidence` / `Hypothesis` | Claims layer |
| `Verse` / `Chapter` / `Book` | Corpus text nodes |
| `IRNode:Entity` / `IRNode:Site` / `IRNode:Artifact` | IR nodes |

Framework-specific labels (added when `.codegraph.yml` specifies a framework):
`CallbackQueryHandler`, `CommandHandler`, `EventHandler`, `Middleware`, `BotFactory`

### Edge Types

**Code structure:**
| Edge | Meaning | Key Properties |
|------|---------|---------------|
| `CALLS` | Function invocation | `conditional`, `conditionalKind`, `isAsync`, `crossFile`, `resolutionKind` |
| `CONTAINS` | Parent → child | — |
| `IMPORTS` | File-level import | `dynamic` |
| `RESOLVES_TO` | Import → canonical declaration | — |
| `REGISTERED_BY` | Handler → entrypoint | — |
| `READS_STATE` / `WRITES_STATE` | Function → state field | — |
| `POSSIBLE_CALL` | Dynamic dispatch | `confidence`, `reason` |
| `OWNED_BY` | SourceFile → Author | — |
| `BELONGS_TO_LAYER` | SourceFile → ArchitectureLayer | — |
| `HAS_PARAMETER` / `HAS_MEMBER` | Structural containment | — |
| `EXTENDS` / `IMPLEMENTS` | Inheritance | — |
| `ORIGINATES_IN` | Unresolved reference → source | — |

**Plans & governance:** `PART_OF`, `DEPENDS_ON`, `HAS_CODE_EVIDENCE`, `TARGETS`, `NEXT_STAGE`, `READS_PLAN_FIELD`, `MUTATES_TASK_FIELD`, `EMITS_NODE_TYPE`, `EMITS_EDGE_TYPE`

**Claims & corpus:** `SUPPORTED_BY`, `CONTRADICTED_BY`, `WITNESSES`, `PROVES`, `ANCHORS`, `CROSS_REFERENCES`, `MENTIONS_PERSON`, `MENTIONS`

**Governance provenance:** `MEASURED`, `DERIVED_FROM_PROOF`, `DERIVED_FROM_RUN`, `DERIVED_FROM_COMMIT`, `DERIVED_FROM_GATE`, `AFFECTS_COMMIT`, `CAPTURED_COMMIT`, `CAPTURED_WORKTREE`, `EMITS_GATE_DECISION`, `BASED_ON_RUN`, `GENERATED_ARTIFACT`, `USED_BY`

### Key Node Properties
| Property | Type | On | Meaning |
|----------|------|-----|---------|
| `name` | string | all | Declaration name |
| `filePath` | string | all | Absolute file path |
| `startLine` / `endLine` | int | all | Source location |
| `sourceCode` | string | all | Full source text |
| `kind` | string | CodeNode | Discriminator: Function, Method, Class, Variable, etc. |
| `isExported` | bool | CodeNode | Exported from module? |
| `isInnerFunction` | bool | CodeNode | Declared inside another function? |
| `riskLevel` | float | CodeNode | Pre-computed risk score |
| `riskTier` | string | CodeNode | LOW / MEDIUM / HIGH / CRITICAL |
| `fanInCount` | int | CodeNode | How many things call this |
| `fanOutCount` | int | CodeNode | How many things this calls |
| `lineCount` | int | CodeNode | Lines of code |
| `gitChangeFrequency` | float | SourceFile/CodeNode | 0.0-1.0, how often this changes |
| `authorEntropy` | int | SourceFile | Number of distinct git authors |
| `primaryAuthor` | string | SourceFile | Author with most lines (git blame) |
| `ownershipPct` | int | SourceFile | % of lines owned by primary author |
| `architectureLayer` | string | SourceFile | Inferred layer name |
| `registrationKind` | string | CodeNode/Entrypoint | command, callback, event, middleware |
| `registrationTrigger` | string | CodeNode/Entrypoint | Trigger pattern (e.g., 'start', 'home_buy') |
| `sourceKind` | string | edges | Provenance: 'typeChecker', 'frameworkExtractor', 'heuristic', 'postIngest', 'gitMining' |
| `confidence` | float | edges | 0.0-1.0 confidence of the edge derivation |

### CALLS Edge Properties
| Property | Type | Meaning |
|----------|------|---------|
| `conditional` | bool | Inside if/switch/ternary/catch? |
| `conditionalKind` | string | 'if', 'switch', 'ternary', 'catch', 'logical' |
| `isAsync` | bool | Is the call awaited? |
| `crossFile` | bool | Caller and callee in different files? |
| `resolutionKind` | string | 'internal' (direct) or 'fluent' (method chain) |

---

## Pre-Edit Gate

**Before editing ANY function, call `pre_edit_check` (MCP) or run this:**
```cypher
MATCH (f:Function {name: 'FUNCTION_NAME'})
RETURN f.riskTier, f.riskLevel, f.fanInCount
```

| Verdict | When | Action |
|---------|------|--------|
| 🔴 SIMULATE_FIRST | CRITICAL/HIGH risk or fanIn > 15 | MUST call `simulate_edit` with modified content before writing |
| ⚠️ PROCEED_WITH_CAUTION | MEDIUM risk or fanIn 5-15 | Check callers list, proceed carefully |
| ✅ SAFE | LOW risk and fanIn < 5 | Edit freely |

**This is not optional.** The graph exists to prevent blind edits.

---

## Risk Tiers

Pre-computed on every Function/Method node via `fanIn × fanOut × log(complexity) × (1 + gitChangeFreq)`:

| Tier | riskLevel | Action Required |
|------|-----------|-----------------|
| CRITICAL | > 500 | Check ALL callers. Plan changes across full dependency chain. |
| HIGH | 100-500 | Check dependents before editing. |
| MEDIUM | 10-100 | Normal caution. |
| LOW | < 10 | Leaf functions, utilities. Safe to edit. |

`riskLevel` incorporates temporal coupling and author entropy: `base × (1 + temporalCoupling × 0.1) × (1 + (authorEntropy-1) × 0.15)`

---

## Essential Queries

### Before editing a function:
```cypher
MATCH (f:Function {name: 'FUNCTION_NAME'})
OPTIONAL MATCH (caller)-[r:CALLS]->(f)
RETURN f.riskTier, f.riskLevel, f.fanInCount, f.fanOutCount, f.filePath,
       collect(DISTINCT caller.name) AS calledBy
```

### Blast radius — what breaks if I change this:
```cypher
MATCH (f:Function {name: 'FUNCTION_NAME'})
OPTIONAL MATCH (caller)-[:CALLS]->(f)
OPTIONAL MATCH (f)-[:CALLS]->(callee)
OPTIONAL MATCH (f)-[:READS_STATE]->(r:Field)
OPTIONAL MATCH (f)-[:WRITES_STATE]->(w:Field)
RETURN f.name, f.riskTier, f.riskLevel,
       collect(DISTINCT caller.name) AS calledBy,
       collect(DISTINCT callee.name) AS calls,
       collect(DISTINCT r.name) AS readsState,
       collect(DISTINCT w.name) AS writesState
```

### Who owns this file:
```cypher
MATCH (sf:SourceFile {name: 'FILENAME.ts'})-[:OWNED_BY]->(a:Author)
RETURN a.name AS owner, sf.ownershipPct AS pct, sf.authorEntropy AS authors
```

### Architecture layer violations:
```cypher
MATCH (sf1:SourceFile)-[:IMPORTS]->(sf2:SourceFile)
WHERE sf1.architectureLayer IS NOT NULL AND sf2.architectureLayer IS NOT NULL
RETURN sf1.architectureLayer AS from, sf2.architectureLayer AS to,
       sf1.filePath AS importer, sf2.filePath AS imported
```

### Hidden dependencies (temporal coupling):
```cypher
MATCH (a:SourceFile {projectId: 'PID'})-[r:CO_CHANGES_WITH]->(b)
WHERE NOT (a)-[:IMPORTS]->(b) AND NOT (b)-[:IMPORTS]->(a)
RETURN a.filePath, b.filePath, r.coChangeCount
ORDER BY r.coChangeCount DESC LIMIT 10
```

### Cross-layer call flow:
```cypher
MATCH (sf1:SourceFile {projectId: 'PID'})-[:CONTAINS]->(caller)-[:CALLS]->(callee)<-[:CONTAINS]-(sf2:SourceFile)
WHERE sf1.architectureLayer <> sf2.architectureLayer
RETURN sf1.architectureLayer AS fromLayer, sf2.architectureLayer AS toLayer, count(*) AS calls
ORDER BY calls DESC
```

### Module-level state in a file:
```cypher
MATCH (s:SourceFile)-[:CONTAINS]->(v:Variable)
WHERE s.name = 'FILENAME.ts'
RETURN v.name, v.isExported, v.startLine
ORDER BY v.startLine
```

### Riskiest functions:
```cypher
MATCH (f:Function)
WHERE f.riskTier IN ['CRITICAL', 'HIGH']
RETURN f.name, f.riskTier, f.riskLevel, f.fanInCount, f.filePath
ORDER BY f.riskLevel DESC
LIMIT 20
```

### Files affected by a change:
```cypher
MATCH (changed:SourceFile {name: 'FILENAME.ts'})
MATCH (dep:SourceFile)-[:IMPORTS]->(changed)
RETURN dep.name AS dependentFile
```

### State flow through a handler:
```cypher
MATCH (f:Function {name: 'HANDLER_NAME'})
OPTIONAL MATCH (f)-[:READS_STATE]->(r:Field)
OPTIONAL MATCH (f)-[:WRITES_STATE]->(w:Field)
RETURN collect(DISTINCT r.name) AS reads, collect(DISTINCT w.name) AS writes
```

### Who reads/writes a state field:
```cypher
MATCH (f)-[e:WRITES_STATE|READS_STATE]->(field:Field {name: 'FIELD_NAME'})
RETURN f.name, type(e) AS access, f.filePath
```

### Multi-author files (fragmented ownership):
```cypher
MATCH (sf:SourceFile {projectId: 'PID'})
WHERE sf.authorEntropy > 1
RETURN sf.filePath, sf.primaryAuthor, sf.ownershipPct, sf.authorEntropy
ORDER BY sf.authorEntropy DESC
```

### Full project overview:
```cypher
MATCH (p:Project)
RETURN p.name, p.projectId, p.nodeCount, p.edgeCount, p.status
```

---

## MCP Tools

If the MCP server is running (`node codegraph/dist/mcp/mcp.server.js`), these tools are available:

| Tool | Use For |
|------|---------|
| `pre_edit_check` | **ALWAYS call before editing a function.** Returns verdict + callers + state + coupling. |
| `simulate_edit` | When pre_edit_check says SIMULATE_FIRST. Shows full graph delta before applying. |
| `impact_analysis` | Deep blast radius with transitive dependents and risk scoring. |
| `search_codebase` | Natural language code search (uses embeddings). |
| `natural_language_to_cypher` | Ask structural questions in plain English. |
| `traverse_from_node` | Walk the graph from a specific node. |
| `detect_dead_code` | Find unused exports. |
| `detect_duplicate_code` | Find near-duplicates by normalized hash. |
| `list_projects` | Get project name and ID. |
| `save_session_bookmark` / `restore_session_bookmark` | Cross-session continuity. |
| `save_session_note` / `recall_session_notes` | Persistent notes. |
| `swarm_post_task` | Post refactoring task with dependencies and context. |
| `swarm_claim_task` | Claim a pending task. Returns unread messages. |
| `swarm_complete_task` | Complete/fail/request_review/approve/reject. |
| `swarm_get_tasks` | Query tasks by status/agent/swarm. |
| `swarm_message` | Agent-to-agent messaging (blocked/conflict/alert/handoff). |
| `swarm_pheromone` | Deposit coordination signals on nodes. |
| `swarm_sense` | Read pheromones near a node. |
| `swarm_graph_refresh` | Re-parse changed files after edits. Workers MUST call before completing. |
| `state_impact` | Query state field access patterns. Shows readers/writers, detects race conditions. |
| `registration_map` | Query framework entrypoints. "What happens when the user sends /buy?" |
| `detect_hotspots` | Ranked list of functions with highest risk × change frequency. |
| `plan_status` | Completion rates per plan project (done/planned/drift). |
| `plan_drift` | Tasks with code evidence but unchecked boxes. |
| `plan_gaps` | Planned tasks with zero evidence. |
| `plan_query` | Free-form plan graph queries. |
| `plan_priority` | Dynamic priority ranking — "what should I build next?" |
| `claim_status` | Overview of claims by domain and status. |
| `evidence_for` | Evidence supporting/contradicting a specific claim. |
| `contradictions` | Find contested or contradicted claims. |
| `hypotheses` | Auto-generated investigation targets from evidence gaps. |
| `claim_generate` | Run claim generation pipeline across all domains. |
| `self_audit` | Summary / generate audit questions / apply verdicts. |

MCP config for Claude Code (`.mcp.json` in project root):
```json
{
  "mcpServers": {
    "codegraph": {
      "command": "node",
      "args": ["/home/jonathan/.openclaw/workspace/codegraph/dist/mcp/mcp.server.js"]
    }
  }
}
```

**You don't need MCP to use the graph.** `cypher-shell` works from any terminal. MCP adds convenience tools.

---

## Operations

### Parse + ingest a project:
```bash
cd codegraph && npx tsx src/scripts/entry/parse-and-ingest.ts
```

### Full post-ingest pipeline (17 steps):
```bash
cd codegraph && bash post-ingest-all.sh
```
Steps: risk scoring → state edges → git frequency → temporal coupling → POSSIBLE_CALL → virtual dispatch → registration properties → project node → author ownership → architecture layers → riskLevel v2 promotion → provenance + confidence → unresolved reference nodes → audit subgraph → test coverage mapping → embeddings → evaluation (regression detection)

### Run evaluation (regression detection):
```bash
cd codegraph && npx tsx run-evaluation.ts [projectId]
```

### Run tests:
```bash
cd codegraph && npx vitest run tests/graph-integrity.test.ts
```

### Verify completeness:
```bash
cd codegraph && npx tsx verify-completeness.ts
```

### Compute reparse set (what files need reparsing if X changes):
```bash
cd codegraph && npx tsx compute-reparse-set.ts FILENAME.ts
```

### Edit simulation (preview changes before applying):
```bash
cd codegraph && npx tsx edit-simulation.ts <file> <modified-file>
```

### Temporal coupling (mine co-change patterns from git):
```bash
cd codegraph && npx tsx temporal-coupling.ts codegraph
```

### Author ownership (git blame → OWNED_BY edges):
```bash
cd codegraph && npx tsx seed-author-ownership.ts codegraph
```

### Architecture layers (directory → layer classification + violation detection):
```bash
cd codegraph && npx tsx seed-architecture-layers.ts codegraph
```

### File watcher (incremental re-parse on save):
```bash
cd codegraph && npx tsx src/scripts/entry/watch.ts codegraph
```

### Start Neo4j (after reboot):
```bash
sudo neo4j start
```

---

---

## Plan Tracking

Plans are parsed from markdown files in `plans/` into Task/Milestone/Sprint/Decision nodes.

### Cross-domain evidence
```cypher
-- What plan tasks have code evidence?
MATCH (t:Task)-[:HAS_CODE_EVIDENCE]->(sf)
RETURN t.name, t.status, sf.name, t.projectId
ORDER BY t.projectId

-- Drift: planned but code exists
MATCH (t:Task {status: 'planned'})
WHERE t.hasCodeEvidence = true
RETURN t.name, t.projectId

-- Milestone completion
MATCH (t:Task)-[:PART_OF]->(m:Milestone)
WITH m, count(t) AS total, sum(CASE WHEN t.status='done' THEN 1 ELSE 0 END) AS done
RETURN m.name, done, total, round(toFloat(done)/total*100) + '%'
ORDER BY m.projectId
```

### Plan↔Code links
| Plan Project | Code Project |
|-------------|-------------|
| `plan_codegraph` | `proj_c0d3e9a1f200` |
| `plan_godspeed` | `proj_60d5feed0001` |
| `plan_bible_graph` | `proj_0e32f3c187f4` |
| `plan_plan_graph` | `proj_c0d3e9a1f200` |

---

## Claims & Reasoning

The claim layer generates domain-agnostic assertions with evidence.

### Claim types
| Type | Domain | What It Claims |
|------|--------|---------------|
| `edit_safety` | code | "Function X is high-risk (level Y, Z callers)" |
| `task_completion` | plan | "Task X is complete" (with code evidence) |
| `plan_drift` | plan | "Task X may be complete but isn't checked off" |
| `entity_identity` | corpus | "Moses appears across 4 corpora" |
| `cross_cutting_impact` | cross | "Editing X invalidates evidence for Y plan tasks" |
| `bottleneck` | plan | "Sprint X is 41% complete — 23 remaining" |
| `temporal_coupling` | code | "A and B change together (8 co-commits)" |
| `coverage_gap` | code | "85 of 85 high-risk functions have no tests" |
| `entity_centrality` | cross | "God: 11,194 mentions across 2 corpora" |

### Key queries
```cypher
-- Cross-cutting: what plan tasks break if I edit this file?
MATCH (c:Claim {claimType: 'cross_cutting_impact'})
RETURN c.statement, c.taskCount ORDER BY c.taskCount DESC

-- Bottlenecks
MATCH (c:Claim {claimType: 'bottleneck'})
RETURN c.statement, c.completionRate ORDER BY c.completionRate ASC

-- All claims about a project
MATCH (c:Claim {projectId: 'proj_c0d3e9a1f200'})
RETURN c.claimType, c.status, c.confidence, c.statement
ORDER BY c.confidence ASC LIMIT 20
```

---

## Self-Audit

The graph generates verification questions about its own state.

**Flow**: `getDriftItems()` → `buildAuditQuestions()` → agent verifies → `applyVerdict()` → graph updates

**Verdicts**: `CONFIRMED` (check box, keep evidence), `FALSE_POSITIVE` (remove evidence, record in node), `PARTIAL` (flag for review)

**Audit memory**: Tasks with `auditVerdict='FALSE_POSITIVE'` are skipped on re-ingest. Verdicts survive plan re-parsing.

```cypher
-- What's been audited?
MATCH (t:Task) WHERE t.auditVerdict IS NOT NULL
RETURN t.auditVerdict, count(t), collect(t.name)[..3]
```

---

## Rules

1. **ALWAYS run pre_edit_check** before editing any function. No exceptions.
2. **If verdict is SIMULATE_FIRST**, call simulate_edit before writing. No shortcuts.
3. **Check module-level variables** before adding state — it might already exist.
4. **fanInCount > 10 = widely used.** Signature changes affect many callers.
5. **Check READS_STATE/WRITES_STATE** before touching session/state handling.
6. **Inner functions** (`isInnerFunction=true`) are helpers inside parent functions — they have their own call graphs.
7. **Check architectureLayer** before adding cross-layer dependencies. Don't create new violations.
8. **100% coverage** — every declaration in the source is in the graph. If it's not in the graph, it's not in the code.
9. **Check cross-cutting claims** before editing high-risk files. Plan tasks may depend on them.
10. **Self-audit verdicts are permanent.** Don't re-create evidence for tasks marked FALSE_POSITIVE.

---

## End-to-End Execution Loop (Mandatory)

When asked "what next?", run this loop in order:

**Graph-order discipline rule:** if a proposed next step is not present as a Task node in the plan graph, add it to the appropriate plan markdown first, re-ingest plans, then execute. Do not perform off-graph follow-on work except emergency break/fix.

1. **State snapshot**
   - `session_context_summary` (cold-start from graph truth)
   - `plan_status`
   - `plan_priority`
   - `self_audit` summary

2. **Choose work by unblock value**
   - Highest priority tasks first (downstream unblock score)
   - Prefer tasks with existing evidence for rapid closure

3. **Implement with safety gate**
   - `pre_edit_check` before edits
   - `simulate_edit` when verdict requires it

4. **Refresh graph state**
   - Reparse / watcher refresh
   - Confirm node/edge updates visible

5. **Reconcile plan truth**
   - `plan_drift` + `self_audit` verdicts
   - Update checkboxes for confirmed completions

6. **Close the loop**
   - Re-run `plan_priority` and `plan_status`
   - Commit code + plan + docs together

If this loop is skipped, the graph drifts from reality.

## Definition of Done (Per Task)
A task is only "done" when all are true:
- Implementation exists in graph-linked evidence
- Plan status is checked/updated
- Drift for that task is resolved or audited
- Priority recalculation reflects new state
- Changes are committed

## Dependency Hygiene
For dynamic prioritization to work, dependencies must be explicit:
- encode milestone/task dependencies via `BLOCKS` / `DEPENDS_ON`
- for ordered milestone families (`DL-*`, `GM-*`), every non-starter task must have task-level `DEPENDS_ON`
- if a task must be dependency-free by design, mark it explicitly with `NO_DEPENDS_OK(reason|expires:YYYY-MM-DD)`
- re-ingest plans after dependency edits
- verify dependency edges in Neo4j before trusting ranking
- run `plan:deps:verify` (and gate on it) before declaring ordering-safe execution

## Integrity Gate (Mandatory Before Declaring Done)
Before declaring any implementation task complete, run:

```bash
npm run done-check
```

`done-check` currently executes:
1. `npm run build`
2. `npm run edges:normalize`
3. `npm run plan:evidence:recompute`
4. `npm run registry:reconcile`
5. `npm run registry:verify`
6. `npm run edges:verify`
7. `npm run parser:contracts:verify`
8. `npm run plan:deps:verify`
9. `npm run integrity:snapshot`
10. `npm run integrity:verify`

Rules:
- If gate fails, task is **not done**.
- Record gate failure in plan/task notes and continue remediation.
- Do not mark plan checkboxes complete without integrity evidence artifact (command output + commit).
- Temporary threshold overrides must be explicit and documented in commit message (no silent relaxations).

Strict rollout commands:
- `npm run done-check:strict:smoke` (strict dependency mode, advisory document/metrics enforcement; includes capture-only runtime proof)
- `npm run done-check:strict:full` (strict dependency + fail-closed document/metrics enforcement; includes capture-only runtime proof)
- Dev-only override for dirty worktree capture: `VERIFICATION_CAPTURE_ALLOW_DIRTY=true`
- GM-8 closure guard: `plan:deps:verify` fails when a GM-8 task is `done` without `HAS_CODE_EVIDENCE`.
- Runbook: `docs/GOVERNANCE_STRICT_ROLLOUT.md`

### IR Parity Gate (Required for IR pipeline changes)
When touching parser/IR/materializer paths, also run:

```bash
npm run ir:parity
```

Checkpoint/resume options:
- `npm run ir:parity:resume` (resume + retry failed targets)
- `npm run ir:parity -- --force-target=<name>` to run a single target (`codegraph|godspeed|bible-graph`)
- `npm run ir:parity -- --fresh` to ignore prior state and start clean

### Verification Pipeline (SARIF → Scope → Gate → Runtime Truth)

The verification subsystem ingests tool findings, enforces governance, and captures execution proof in the graph.

**Recommendation freshness rule (VG-6):** before running `plan_priority` or `plan_next_tasks`, re-ingest plans if there were markdown edits in `plans/` (`npx tsx src/core/parsers/plan-parser.ts /home/jonathan/.openclaw/workspace/plans --ingest --enrich`). MCP tools now hard-fail with `PLAN_FRESHNESS_GUARD_FAILED` when plan ingest is stale unless `allowStale=true`.

**Governance freshness source rule:** `governance:stale:verify` uses the newest runtime evidence timestamp from either `VerificationRun.ranAt` or `GovernanceMetricSnapshot.timestamp`.

**Commands (in pipeline order):**
```bash
# 1. Import SARIF findings into VerificationRun + AdjudicationRecord + AnalysisScope nodes
npm run verification:sarif:import -- <projectId> <sarifPath>

# 2. Scope-aware resolver: recompute scope, downgrade clean runs, enforce UNKNOWN_FOR, detect contradictions
npm run verification:scope:resolve -- <projectId>

# 3. Exception enforcement: waiver policy (dual approval, expiry, ticket linkage, truth/gate separation)
npm run verification:exception:enforce -- <projectId>

# 4. Advisory gate: compute advisory decisions, persist decision logs + replayability hashes
npm run verification:advisory:gate -- <projectId> [policyBundleId]

# 5. Runtime truth capture:
#    - canonical strict path: use done-check strict scripts (they chain capture-only)
#    - explicit capture-only path (after another gate run):
npm run verification:done-check:capture:only -- [projectId] [policyBundleId]
#    - legacy wrapper (runs done-check + capture):
npm run verification:done-check:capture -- [projectId] [policyBundleId]

# 6. Commit audit: invariant checks over a commit range (schema, edge taxonomy, deps, parser contracts, coverage drift)
npm run commit:audit:verify -- <baseRef> <headRef>
```

**Graph nodes produced:**
- `VerificationRun` — tool finding with attestation, provenance, lifecycle state
- `AdjudicationRecord` — suppression/waiver with policy compliance fields
- `AnalysisScope` — scope completeness metadata
- `AdvisoryGateDecision` — deterministic gate decision with replay hash
- `GateDecision` — runtime gate pass/fail with decision hash
- `CommitSnapshot` — HEAD sha + branch at execution time
- `WorkingTreeSnapshot` — dirty flag + diff hash at execution time
- `Artifact` — integrity snapshot file hash

**Key edges:**
- `CAPTURED_COMMIT`, `CAPTURED_WORKTREE`, `EMITS_GATE_DECISION`, `BASED_ON_RUN`, `GENERATED_ARTIFACT`
- `ADVISES_ON` (advisory gate → verification run)
- `ADJUDICATES` (adjudication → verification run)
- `HAS_SCOPE` (verification run → analysis scope)

**MCP tools:**
- `commit_audit_status` — shows latest commit audit results from `artifacts/commit-audit/latest.json`
- `recommendation_proof_status` — recommendation truth-health panel (`freshness`, `done_vs_proven`, `mismatch_rate`) for a plan project
- `governance_metrics_status` — latest/trend governance observability snapshot (`verificationRuns`, `gateFailures`, `failuresResolvedBeforeCommit`, `regressionsAfterMerge`, `interceptionRate`)
