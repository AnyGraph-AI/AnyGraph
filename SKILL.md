# CodeGraph — Agent Skill

## What This Is

A Neo4j code knowledge graph containing **every declaration** in the codebase — functions, classes, methods, variables, imports, types — as nodes. Every call, import, containment, state access, ownership, and co-change pattern is an edge. Risk scores, fan-in/fan-out, architecture layers, and author ownership are pre-computed.

**You query the graph before you edit. That's not a suggestion.**

## Connection

```bash
cypher-shell -u neo4j -p codegraph "YOUR CYPHER QUERY"
```
- Auth: `neo4j` / `codegraph`
- URI: `bolt://localhost:7687`

If MCP tools are available, prefer them. If not, `cypher-shell` does everything.

---

## First Contact — What To Do When You Start

**Step 1:** Discover what's in the graph.
```cypher
MATCH (p:Project) RETURN p.name, p.projectId, p.nodeCount, p.edgeCount
```

**Step 2:** Get the architecture overview.
```cypher
MATCH (n {projectId: 'PID'}) RETURN labels(n)[0] AS type, count(n) AS cnt ORDER BY cnt DESC
```

**Step 3:** Find the riskiest functions (these are the landmines).
```cypher
MATCH (f {projectId: 'PID'})
WHERE (f:Function OR f:Method) AND f.riskTier IN ['CRITICAL', 'HIGH']
RETURN f.name, f.riskTier, round(f.riskLevel) AS risk, f.fanInCount, f.filePath
ORDER BY f.riskLevel DESC LIMIT 20
```

**Step 4:** Understand the file structure.
```cypher
MATCH (sf:SourceFile {projectId: 'PID'})
RETURN sf.filePath, sf.architectureLayer, sf.primaryAuthor, sf.authorEntropy
ORDER BY sf.architectureLayer, sf.filePath
```

After these 4 queries you know: what projects exist, what node types they contain, where the danger zones are, and how the code is organized. You're oriented.

---

## The Pre-Edit Protocol

### Before editing ANY function:

1. **Call `pre_edit_check`** (MCP) or run:
```cypher
MATCH (f {projectId: 'PID'})
WHERE (f:Function OR f:Method) AND f.name = 'FUNCTION_NAME'
OPTIONAL MATCH (caller)-[:CALLS]->(f)
RETURN f.riskTier, round(f.riskLevel) AS risk, f.fanInCount, f.fanOutCount,
       f.lineCount, f.isExported, f.filePath,
       collect(DISTINCT caller.name) AS calledBy
```

2. **Check the verdict:**

| Verdict | When | Action |
|---------|------|--------|
| 🔴 SIMULATE_FIRST | CRITICAL/HIGH risk OR fanIn > 15 | MUST call `simulate_edit` with modified content before writing |
| ⚠️ PROCEED_WITH_CAUTION | MEDIUM risk OR fanIn 5-15 | Review callers list, proceed carefully |
| ✅ SAFE | LOW risk AND fanIn < 5 | Edit freely |

3. **If SIMULATE_FIRST:** Call `simulate_edit` with the file path and your modified content. It parses the change against the current graph and shows: nodes added/removed, calls added/removed, exports changed, broken callers, risk assessment (SAFE/CAUTION/DANGEROUS/CRITICAL). Fix breakages before writing.

**This is not optional.** The graph exists to prevent blind edits.

---

## MCP Tools

Current MCP surface (grouped):

### Core graph + safety
- `pre_edit_check` — **always** before editing a function
- `simulate_edit` — parse-and-diff safety simulation before risky edits
- `impact_analysis` — transitive blast radius, affected files, risk
- `state_impact` — readers/writers for state fields
- `registration_map` — runtime entrypoint routing map
- `detect_hotspots` — risk × churn hotspots
- `search_codebase` — semantic code search
- `traverse_from_node` — structural graph traversal
- `natural_language_to_cypher` — NL → Cypher conversion

### Discovery + project ops
- `list_projects`
- `parse_typescript_project`
- `check_parse_status`
- `start_watch_project` / `stop_watch_project` / `list_watchers`
- `test_neo4j_connection`

### Plan graph
- `plan_status`
- `plan_drift`
- `plan_gaps`
- `plan_query`
- `plan_priority`
- `plan_next_tasks`

### Claim layer
- `claim_status`
- `evidence_for`
- `contradictions`
- `hypotheses`
- `claim_generate`
- `claim_chain_path` (code → plan → document/corpus chain view)

### Governance / verification status
- `parser_contract_status`
- `commit_audit_status`
- `recommendation_proof_status`
- `governance_metrics_status`
- `self_audit`

### Session continuity + cold start
- `save_session_bookmark` / `restore_session_bookmark`
- `save_session_note` / `recall_session_notes`
- `cleanup_session`
- `session_context_summary` (graph cold-start: in-progress/blocked/recent changes)

### Swarm coordination
- `swarm_graph_refresh`
- `swarm_post_task`
- `swarm_claim_task`
- `swarm_complete_task`
- `swarm_get_tasks`
- `swarm_message`
- `swarm_pheromone`
- `swarm_sense`
- `swarm_cleanup`

### Multi-Agent Refactoring

For multi-agent work, read `swarm/COORDINATOR.md` (decomposition algorithm) and `swarm/WORKER.md` (worker protocol). Key rules:
- One writer per file
- Workers complete to `needs_review`, coordinator approves
- Always call `swarm_graph_refresh` after edits
- CRITICAL simulation = stop and alert coordinator

MCP config (`.mcp.json`):
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

**No MCP? No problem.** Every MCP tool maps to Cypher queries. Use `cypher-shell` directly.

---

## Graph Schema

### Node Types
| Type | What It Represents |
|------|-------------------|
| `SourceFile` | A `.ts` file |
| `Function` | Named function (top-level or inner) |
| `Method` | Class method |
| `Class` | Class declaration |
| `Interface` | Interface declaration |
| `TypeAlias` | `type X = ...` |
| `Variable` | const/let/var (exported AND non-exported module-scope state) |
| `Property` | Class property |
| `Parameter` | Function/method parameter |
| `Import` | Import statement |
| `Field` | Tracked state field (e.g., `ctx.session.pendingBuy`) |
| `Entrypoint` | Framework registration point (command, callback, event) |
| `Author` | Git author (from `git blame`) |
| `ArchitectureLayer` | Inferred layer (Presentation, Domain, Data, etc.) |
| `Project` | Top-level project node with counts and status |
| `UnresolvedReference` | Import/call the parser couldn't resolve |
| `AuditCheck` | Structural invariant check result |
| `InvariantViolation` | Specific invariant failure |
| `EvaluationRun` | Metrics snapshot for regression tracking |
| `MetricResult` | Single metric value from an evaluation run |

### Edge Types
| Edge | Meaning | Key Properties |
|------|---------|---------------|
| `CALLS` | Function invocation | `conditional`, `conditionalKind`, `isAsync`, `crossFile`, `resolutionKind` |
| `CONTAINS` | Parent → child (file→fn, fn→inner fn, class→method) | — |
| `IMPORTS` | File-level import | `dynamic` (true for `await import()`) |
| `RESOLVES_TO` | Import symbol → canonical declaration across files | — |
| `REGISTERED_BY` | Handler → entrypoint registration | — |
| `READS_STATE` | Function → Field it reads | — |
| `WRITES_STATE` | Function → Field it writes | — |
| `POSSIBLE_CALL` | Dynamic dispatch target | `confidence`, `reason` |
| `CO_CHANGES_WITH` | File ↔ File temporal coupling from git | `coChangeCount`, `strength` |
| `OWNED_BY` | SourceFile → Author (primary git blame owner) | — |
| `BELONGS_TO_LAYER` | SourceFile → ArchitectureLayer | — |
| `HAS_PARAMETER` | Function → Parameter | — |
| `HAS_MEMBER` | Class/Interface → Method/Property | — |
| `ORIGINATES_IN` | UnresolvedReference → Function/File | — |
| `FOUND` | AuditCheck → InvariantViolation | — |
| `MEASURED` | EvaluationRun → MetricResult | — |

### Key Properties

**On Functions/Methods:**
- `riskLevel` (float) — pre-computed risk score
- `riskTier` — LOW / MEDIUM / HIGH / CRITICAL
- `fanInCount` — how many things call this
- `fanOutCount` — how many things this calls
- `lineCount` — lines of code
- `isExported` — exported from module?
- `isInnerFunction` — declared inside another function (closure)?
- `sourceCode` — **full source text of the function** (read implementations without opening files!)
- `registrationKind` — command, callback, event, middleware (framework handlers)
- `registrationTrigger` — what triggers this handler (e.g., 'start', 'buy_confirm')

**On SourceFiles:**
- `gitChangeFrequency` (0.0-1.0) — how often this file changes
- `authorEntropy` (int) — number of distinct git authors (higher = more fragmented ownership)
- `primaryAuthor` — author with most lines
- `ownershipPct` — % of lines owned by primary author
- `architectureLayer` — Presentation, Domain, Data, Entry, API, etc.

**On CALLS edges:**
- `conditional` — inside if/switch/ternary/catch? Unconditional callers = guaranteed break. Conditional = maybe.
- `conditionalKind` — 'if', 'switch', 'ternary', 'catch', 'logical'
- `isAsync` — call is awaited?
- `crossFile` — caller and callee in different files?
- `resolutionKind` — 'internal' (resolved) or 'fluent' (method chain)

---

## Query Cookbook

### Blast radius — what breaks if I change this:
```cypher
MATCH (f:Function {name: 'NAME', projectId: 'PID'})
OPTIONAL MATCH (caller)-[:CALLS]->(f)
OPTIONAL MATCH (f)-[:CALLS]->(callee)
OPTIONAL MATCH (f)-[:READS_STATE]->(r:Field)
OPTIONAL MATCH (f)-[:WRITES_STATE]->(w:Field)
RETURN f.riskTier, round(f.riskLevel) AS risk,
       collect(DISTINCT caller.name) AS calledBy,
       collect(DISTINCT callee.name) AS calls,
       collect(DISTINCT r.name) AS readsState,
       collect(DISTINCT w.name) AS writesState
```

### Guaranteed vs conditional callers:
```cypher
MATCH (caller)-[c:CALLS]->(f:Function {name: 'NAME', projectId: 'PID'})
RETURN caller.name, c.conditional, c.conditionalKind, caller.filePath
ORDER BY c.conditional
```
Unconditional callers (conditional=false) WILL break. Conditional callers MIGHT break.

### Read a function's source code from the graph:
```cypher
MATCH (f:Function {name: 'NAME', projectId: 'PID'})
RETURN f.sourceCode
```
You can understand what a function does without opening the file.

### Who else writes the same state field:
```cypher
MATCH (f)-[:WRITES_STATE]->(field:Field {name: 'FIELD', projectId: 'PID'})
RETURN f.name AS writer, f.filePath
```
Multiple writers on the same state = race condition risk.

### Files affected by a change:
```cypher
MATCH (changed:SourceFile {name: 'FILE.ts', projectId: 'PID'})
MATCH (dep:SourceFile)-[:IMPORTS]->(changed)
RETURN dep.name AS dependentFile
```

### Hidden dependencies (temporal coupling):
```cypher
MATCH (a:SourceFile {projectId: 'PID'})-[r:CO_CHANGES_WITH]->(b)
WHERE NOT (a)-[:IMPORTS]->(b) AND NOT (b)-[:IMPORTS]->(a)
RETURN a.filePath, b.filePath, r.coChangeCount
ORDER BY r.coChangeCount DESC LIMIT 10
```
These files always change together but don't import each other. Change one → you probably need to change the other.

### Architecture layer violations:
```cypher
MATCH (sf1:SourceFile {projectId: 'PID'})-[:IMPORTS]->(sf2:SourceFile)
WHERE sf1.architectureLayer IS NOT NULL AND sf2.architectureLayer IS NOT NULL
  AND sf1.architectureLayer <> sf2.architectureLayer
RETURN sf1.architectureLayer AS from, sf2.architectureLayer AS to,
       sf1.filePath AS importer, sf2.filePath AS imported
```

### Cross-layer call flow:
```cypher
MATCH (sf1:SourceFile {projectId: 'PID'})-[:CONTAINS]->(caller)-[:CALLS]->(callee)<-[:CONTAINS]-(sf2:SourceFile)
WHERE sf1.architectureLayer <> sf2.architectureLayer
RETURN sf1.architectureLayer AS fromLayer, sf2.architectureLayer AS toLayer, count(*) AS calls
ORDER BY calls DESC
```

### Who owns a file:
```cypher
MATCH (sf:SourceFile {projectId: 'PID'})-[:OWNED_BY]->(a:Author)
RETURN sf.filePath, a.name AS owner, sf.ownershipPct, sf.authorEntropy
ORDER BY sf.authorEntropy DESC
```
High authorEntropy = fragmented ownership = higher risk of miscommunication on changes.

### Multi-author files (fragmented ownership):
```cypher
MATCH (sf:SourceFile {projectId: 'PID'})
WHERE sf.authorEntropy > 2
RETURN sf.filePath, sf.primaryAuthor, sf.ownershipPct, sf.authorEntropy
ORDER BY sf.authorEntropy DESC
```

### Find framework handlers by trigger pattern:
```cypher
MATCH (h {projectId: 'PID'})
WHERE h.registrationTrigger CONTAINS 'buy'
RETURN h.name, h.registrationKind, h.registrationTrigger, h.filePath
```

### Module-level state in a file:
```cypher
MATCH (s:SourceFile {projectId: 'PID'})-[:CONTAINS]->(v:Variable)
WHERE s.name = 'FILE.ts'
RETURN v.name, v.isExported, v.startLine
ORDER BY v.startLine
```
Check this before adding state — the variable might already exist.

### Dead code (exported but never called):
```cypher
MATCH (f {projectId: 'PID'})
WHERE (f:Function OR f:Method) AND f.isExported = true
AND NOT ()-[:CALLS]->(f) AND NOT (f)<-[:REGISTERED_BY]-()
RETURN f.name, f.filePath
```

### God functions (>200 lines):
```cypher
MATCH (f:Function {projectId: 'PID'})
WHERE f.lineCount > 200
RETURN f.name, f.lineCount, round(f.riskLevel) AS risk, f.filePath
ORDER BY f.lineCount DESC
```

### Inner functions trapped in a parent:
```cypher
MATCH (parent:Function {projectId: 'PID'})-[:CONTAINS]->(inner:Function)
WITH parent, count(inner) AS innerCount
WHERE innerCount > 3
RETURN parent.name, innerCount, parent.lineCount, parent.filePath
ORDER BY innerCount DESC
```

---

## When to Use Graph vs Read Files

| Situation | Use |
|-----------|-----|
| "What calls this function?" | Graph (`CALLS` edges) |
| "What's the blast radius?" | Graph (`pre_edit_check` or `impact_analysis`) |
| "What does this function do?" | Graph (`sourceCode` property) — often enough |
| "I need to understand complex logic in detail" | Read the file |
| "What state does this handler touch?" | Graph (`READS_STATE`/`WRITES_STATE`) |
| "Is this function used anywhere?" | Graph (dead code query) |
| "Who should review changes to this file?" | Graph (`OWNED_BY` → Author) |
| "What layer is this in? Am I creating a violation?" | Graph (`architectureLayer`) |
| "What files always change with this one?" | Graph (`CO_CHANGES_WITH`) |
| "I need to see the full file context" | Read the file |

**The graph gives you structural awareness. Files give you implementation detail. Use both.**

---

## Multi-Project Awareness

The graph may contain multiple projects. **Always filter by `projectId`** in your queries to avoid cross-contamination:

```cypher
// WRONG — queries across all projects
MATCH (f:Function {name: 'run'}) RETURN f

// RIGHT — scoped to one project
MATCH (f:Function {name: 'run', projectId: 'proj_c0d3e9a1f200'}) RETURN f
```

Use `list_projects` (MCP) or the Project query to find the right `projectId`.

---

## Risk Tiers

| Tier | riskLevel | What It Means |
|------|-----------|---------------|
| CRITICAL | > 500 | God functions, core infrastructure. Check ALL callers. Full dependency chain analysis. |
| HIGH | 100-500 | Widely-used functions. Check dependents before editing. |
| MEDIUM | 10-100 | Normal functions. Standard caution. |
| LOW | < 10 | Leaf functions, utilities, helpers. Safe to edit. |

`riskLevel` incorporates temporal coupling and author entropy:
`base × (1 + temporalCoupling × 0.1) × (1 + (authorEntropy-1) × 0.15)`

---

## Rules

1. **ALWAYS call `pre_edit_check` before editing a function.** No exceptions.
2. **If verdict is SIMULATE_FIRST, you MUST call `simulate_edit` before writing.** No shortcuts.
3. **`fanInCount` > 10 = widely used.** Signature changes affect many callers.
4. **Check `READS_STATE`/`WRITES_STATE`** before modifying state handling. Multiple writers on the same field = race condition.
5. **Inner functions** (`isInnerFunction=true`) have their own call graphs — check them too.
6. **Check `architectureLayer`** before adding cross-layer dependencies. Don't create new violations.
7. **Check `authorEntropy`** on multi-author files — coordinate with the primary owner.
8. **Use `sourceCode` property** to read function implementations from the graph before opening files.
9. **Filter by `projectId`** in every query. Never query across projects accidentally.
10. **100% coverage** — every declaration in the source is in the graph. If it's not in the graph, it's not in the code.

---

## Universal Architecture (In Progress)

CodeGraph is expanding from TypeScript-only to a universal reasoning graph. Full plan: `plans/codegraph/MULTI_LANGUAGE_ASSESSMENT.md`

### Three-Tier Parser Architecture
- **Tier 0 (compiler)**: ts-morph (TS ✅), Eclipse JDT (Java), go/ast+go/types (Go), Roslyn (C#)
- **Tier 1 (workspace-semantic)**: Pyright sidecar (Python — NEXT), rust-analyzer (Rust — future)
- **Tier 2 (structural)**: tree-sitter fallback for all other languages

### IR Layer (Coming)
```
Parser → IR → Enrichment → Graph
```
All parsers will output a language-agnostic IR before graph ingestion. This prevents language-specific assumptions from contaminating the enrichment pipeline.

### Plan Graph
Project plans in `plans/` directory are parsed into Task/Milestone/Sprint nodes and cross-referenced against code graphs. Auto-detects task completion by checking if referenced code exists.

### Four Graph Domains
- Code graphs (this skill) — source code structure
- Corpus graphs — Bible, Quran, structured texts
- Document graphs — legal filings, evidence
- Plan graphs — task tracking, cross-domain linking

---

## Process Runbook (Not Just Schema)

Use this skill as an operational procedure, not only a query reference.

### A) Orient
1. List projects
2. Identify active plan project(s)
3. Run plan status + priority

### B) Decide
- Work top-ranked unblock tasks first
- If blocked, choose next independent high-value task

### C) Execute
- Safety gate (`pre_edit_check` → `simulate_edit` if needed)
- Implement change
- Refresh graph

### D) Validate
- Re-check drift
- Apply self-audit verdicts
- Update plan markers

### E) Close
- Recompute priority
- Commit code + plan + docs in same change set

### Operational Guardrails
- Never trust plan checkboxes without evidence links
- Never trust evidence links without self-audit on high-drift projects
- Never trust priority output if dependency edges are missing
- For ordered milestone tracks (`DL-*`, `GM-*`), require task-level `DEPENDS_ON` for every non-starter task
- If a task is intentionally dependency-free, require explicit `NO_DEPENDS_OK(reason|expires:YYYY-MM-DD)` tag

### Integrity Closure Gate (Required)
Before claiming completion, run:

```bash
npm run done-check
```

(Includes edge project-tag normalization, plan evidence recomputation, registry reconciliation/verification, edge-tag taxonomy verification, parser-contract regression checks, plan dependency integrity checks, plus integrity snapshot/verification.)

If it fails:
- Work is still in-progress.
- Record the failing condition (build/integrity/staleness/threshold) in task notes.
- Remediate or explicitly apply documented temporary threshold policy.

### IR Parity Gate (when editing IR flow)
Run this after `done-check` for parser/IR/materializer edits:

```bash
npm run ir:parity
```

Supports deterministic recovery:
- `npm run ir:parity:resume`
- `npm run ir:parity -- --force-target=<name>`
- `npm run ir:parity -- --fresh`

### Verification Pipeline
Post-ingestion verification chain (SARIF → scope → governance → runtime proof):

Dependency-order guard:
- `plan:deps:verify` now reports scoped dependency hygiene metrics (`scopedTasksChecked`, `scopedMissingDepends`, `scopedExceptionCount`).
- Set `STRICT_SCOPED_DEPENDS_ON=true` to fail-closed on missing task-level dependencies in scoped milestone families.

Recommendation freshness rule: if any plan markdown was edited, re-ingest plans before running recommendation tools (`plan_priority`, `plan_next_tasks`). Freshness guard blocks stale recommendations unless `allowStale=true`.

```bash
npm run verification:sarif:import -- <projectId> <sarifPath>
npm run verification:scope:resolve -- <projectId>
npm run verification:exception:enforce -- <projectId>
npm run verification:advisory:gate -- <projectId> [policyBundleId]
npm run verification:done-check:capture -- [projectId] [policyBundleId]
npm run commit:audit:verify -- <baseRef> <headRef>
```

Use `verification:done-check:capture` to record a graph-proven execution trace (git state, gate result, artifact hash). Use `commit:audit:verify` to run invariant checks (schema, edge taxonomy, dependency, parser contract, coverage drift) over any commit range.

MCP status tools:
- `commit_audit_status` — latest commit-audit result view
- `recommendation_proof_status` — recommendation truth-health (`freshness`, `done_vs_proven`, `mismatch_rate`)
- `governance_metrics_status` — governance observability snapshot/trend (`interceptionRate`, gate failures, pre-commit recoveries)

## Full-Capacity Playbooks

### 1) Claim-Chain Workflow (code → plan → document/corpus)
1. `claim_generate` (or run `src/core/claims/claim-engine.ts`) to refresh domain claims.
2. `claims:cross:synthesize` to materialize cross-domain `DEPENDS_ON` + contradictions.
3. `claim_chain_path` to visualize traceable chain paths.
4. If chain count is unexpectedly zero, check `PlanProject-[:TARGETS]->Project` mapping and run `plan:refresh`.

### 2) Cold-Start Workflow (session boot)
1. `session_context_summary` (first) for in-progress/blocked/recent-run state.
2. `plan_status` + `plan_priority` to pick next slice.
3. If stale/freshness issues appear, run `plan:refresh` before asking for next-task recommendations.

### 3) Embedding Matcher Tuning Policy
- Baseline matcher: `plan:embedding:match -- --threshold=0.75 --limit=3` (exploration mode).
- Quality gate: `embedding:fp:verify` and read `artifacts/embedding-matcher/fp-rate-latest.json`.
- Production target: **FP rate < 5%**; for current corpus this is validated with stricter run (`threshold=0.84`, `topK=1`).
- Use `--apply` only after a passing benchmark for the selected threshold profile.

### 4) Live Re-Check Operations
- Code or plan changes → `plan:refresh` → `edges:normalize` → `plan:evidence:recompute`.
- Then run claim refresh as needed (`claim_generate` + `claims:cross:synthesize`).
- Validate with `verification:done-check:capture` so graph/run/artifact hashes are linked.

### 5) Failure Recovery Matrix
- `PLAN_FRESHNESS_GUARD_FAILED` → run `plan:refresh`, then retry recommendation/status tools.
- `invariant_proof_completeness` fail in commit-audit → run `verification:proof:record`, rerun audit.
- Neo4j auth/env issues in gate scripts → verify `.env` + `Neo4jService` env load path, rerun capture.
- Drift alarms spike after structural changes → compare with baseline selector (`verify-graph-integrity.ts`) and apply allowlist policy only if documented in plan.
