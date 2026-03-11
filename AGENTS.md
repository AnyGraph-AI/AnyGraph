# CodeGraph — Agent Instructions

## What This Is

CodeGraph is a Neo4j code knowledge graph. It parses TypeScript codebases into structural nodes and edges,
computes risk scores, tracks state flow, ownership, architecture layers, and temporal coupling — giving AI agents complete architectural awareness before they touch a single line of code.

Every function, class, interface, variable, type alias, method, and property is a node.
Every call, import, containment, state access, ownership, and co-change pattern is an edge.
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

### Node Types
| Type | What It Represents |
|------|-------------------|
| `SourceFile` | A `.ts` file |
| `Function` | Named function declaration (top-level or inner) |
| `Method` | Class method |
| `Class` | Class declaration |
| `Interface` | Interface declaration |
| `TypeAlias` | Type alias (`type X = ...`) |
| `Variable` | const/let/var declaration (exported AND non-exported) |
| `Property` | Class property |
| `Parameter` | Function/method parameter |
| `Import` | Import statement |
| `Field` | Tracked state field (e.g., session properties) |
| `Entrypoint` | Framework registration point |
| `Author` | Git author (from `git blame`) |
| `ArchitectureLayer` | Inferred layer (Presentation, Domain, Data, etc.) |
| `Project` | Top-level project node with stats |

Framework-specific labels (added when `.codegraph.yml` specifies a framework):
`CallbackQueryHandler`, `CommandHandler`, `EventHandler`, `Middleware`, `BotFactory`

### Edge Types
| Edge | Meaning | Key Properties |
|------|---------|---------------|
| `CALLS` | Function invocation | `conditional`, `conditionalKind`, `isAsync`, `crossFile`, `resolutionKind` |
| `CONTAINS` | Parent → child (file→function, function→inner function, class→method) | — |
| `IMPORTS` | File-level import | `dynamic` (true for `await import()`) |
| `RESOLVES_TO` | Import symbol → canonical declaration across files | — |
| `REGISTERED_BY` | Handler → entrypoint registration | — |
| `READS_STATE` | Function → Field (reads session/state) | — |
| `WRITES_STATE` | Function → Field (writes session/state) | — |
| `POSSIBLE_CALL` | Dynamic dispatch target (ternary/interface) | `confidence`, `reason` |
| `CO_CHANGES_WITH` | File → File (temporal coupling from git) | `coChangeCount`, `strength` |
| `OWNED_BY` | SourceFile → Author (primary git blame owner) | — |
| `BELONGS_TO_LAYER` | SourceFile → ArchitectureLayer | — |
| `HAS_PARAMETER` | Function → Parameter | — |
| `HAS_MEMBER` | Class/Interface → Method/Property | — |

### Key Node Properties
| Property | Type | On | Meaning |
|----------|------|-----|---------|
| `name` | string | all | Declaration name |
| `filePath` | string | all | Absolute file path |
| `startLine` / `endLine` | int | all | Source location |
| `sourceCode` | string | all | Full source text |
| `isExported` | bool | Function/Variable/Class | Exported from module? |
| `isInnerFunction` | bool | Function | Declared inside another function? |
| `riskLevel` | float | Function/Method | Pre-computed risk score |
| `riskTier` | string | Function/Method | LOW / MEDIUM / HIGH / CRITICAL |
| `riskLevelV2` | float | Function/Method | Risk with temporal coupling + author entropy |
| `fanInCount` | int | Function/Method | How many things call this |
| `fanOutCount` | int | Function/Method | How many things this calls |
| `lineCount` | int | Function/Method | Lines of code |
| `gitChangeFrequency` | float | SourceFile/Function | 0.0-1.0, how often this changes |
| `authorEntropy` | int | SourceFile | Number of distinct git authors |
| `primaryAuthor` | string | SourceFile | Author with most lines (git blame) |
| `ownershipPct` | int | SourceFile | % of lines owned by primary author |
| `architectureLayer` | string | SourceFile | Inferred layer name |
| `registrationKind` | string | Function/Entrypoint | command, callback, event, middleware |
| `registrationTrigger` | string | Function/Entrypoint | Trigger pattern (e.g., 'start', 'home_buy') |

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

`riskLevelV2` adds temporal coupling and author entropy: `riskLevel × (1 + temporalCoupling × 0.1) × (1 + (authorEntropy-1) × 0.15)`

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
cd codegraph && npx tsx parse-and-ingest.ts
```

### Full post-ingest pipeline (10 steps):
```bash
cd codegraph && bash post-ingest-all.sh
```
Steps: risk scoring → state edges → git frequency → POSSIBLE_CALL → virtual dispatch → registration properties → project node → author ownership → architecture layers → embeddings

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
cd codegraph && npx tsx watch.ts codegraph
```

### Start Neo4j (after reboot):
```bash
sudo neo4j start
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
