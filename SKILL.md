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

| Tool | When to Use |
|------|-------------|
| `pre_edit_check` | **ALWAYS** before editing a function. Returns verdict + full context. |
| `simulate_edit` | When verdict is SIMULATE_FIRST. Shows exact graph delta of your change. |
| `impact_analysis` | Deep blast radius with transitive dependents, risk scoring, affected files. |
| `search_codebase` | Find functions by natural language description (vector embeddings). |
| `natural_language_to_cypher` | Ask structural questions in plain English → Cypher. |
| `traverse_from_node` | Walk the graph from a specific node (callers, callees, imports). |
| `detect_dead_code` | Find exported functions nobody calls. |
| `detect_duplicate_code` | Find near-duplicates by normalized hash. |
| `list_projects` | See all projects in the graph with stats. |
| `swarm_graph_refresh` | After editing files, refresh the graph so next queries see fresh data. |
| `swarm_post_task` | Post refactoring tasks with dependencies for multi-agent work. |
| `swarm_claim_task` | Claim a pending task from the blackboard. |
| `swarm_complete_task` | Complete/fail/request_review/approve/reject tasks. |
| `swarm_get_tasks` | Query tasks by status/agent/swarm. |
| `swarm_message` | Agent-to-agent messaging (blocked/conflict/alert/handoff). |
| `swarm_pheromone` | Deposit coordination signals on nodes. |
| `swarm_sense` | Read pheromones near a node. |
| `state_impact` | Query state field access patterns. Shows readers/writers, detects race conditions. |
| `registration_map` | Query framework entrypoints. "What happens when /buy is sent?" |
| `detect_hotspots` | Ranked functions with highest risk × change frequency. |

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
