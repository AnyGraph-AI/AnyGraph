# CodeGraph — Agent Instructions

## What This Is

CodeGraph is a Neo4j code knowledge graph. It parses TypeScript codebases into structural nodes and edges,
computes risk scores, tracks state flow, and gives AI agents complete architectural awareness
before they touch a single line of code.

Every function, class, interface, variable, type alias, method, and property is a node.
Every call, import, containment, and state access is an edge.
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
| `HAS_PARAMETER` | Function → Parameter | — |
| `HAS_MEMBER` | Class/Interface → Method/Property | — |

### Node Properties
| Property | Type | Meaning |
|----------|------|---------|
| `name` | string | Declaration name |
| `filePath` | string | Absolute file path |
| `startLine` / `endLine` | int | Source location |
| `sourceCode` | string | Full source text |
| `isExported` | bool | Exported from module? |
| `isInnerFunction` | bool | Declared inside another function? |
| `riskLevel` | float | Pre-computed risk score |
| `riskTier` | string | LOW / MEDIUM / HIGH / CRITICAL |
| `fanInCount` | int | How many things call this |
| `fanOutCount` | int | How many things this calls |
| `lineCount` | int | Lines of code |
| `gitChangeFrequency` | float | 0.0-1.0, how often this file changes |
| `registrationKind` | string | Handler type: command, callback, event, middleware |
| `registrationTrigger` | string | What triggers this handler (e.g., 'start', 'home_buy') |
| `callsSuper` | bool | Constructor calls super()? |
| `isOverloadSignature` | bool | TypeScript overload signature? |
| `overloadCount` | int | Number of overload signatures |

### CALLS Edge Properties
| Property | Type | Meaning |
|----------|------|---------|
| `conditional` | bool | Inside if/switch/ternary/catch? |
| `conditionalKind` | string | 'if', 'switch', 'ternary', 'catch', 'logical' |
| `isAsync` | bool | Is the call awaited? |
| `crossFile` | bool | Caller and callee in different files? |
| `resolutionKind` | string | 'internal' (direct) or 'fluent' (method chain) |

---

## Risk Tiers

Pre-computed on every Function/Method node via `fanIn × fanOut × log(complexity) × (1 + gitChangeFreq)`:

| Tier | riskLevel | Action Required |
|------|-----------|-----------------|
| CRITICAL | > 500 | Check ALL callers. Plan changes across full dependency chain. |
| HIGH | 100-500 | Check dependents before editing. |
| MEDIUM | 10-100 | Normal caution. |
| LOW | < 10 | Leaf functions, utilities. Safe to edit. |

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

### Full project overview (run this first on any new project):
```cypher
MATCH (p:Project)
RETURN p.name, p.nodeCount, p.edgeCount, p.status
```

### Architectural overview:
```cypher
MATCH (n)
WHERE n.projectId IS NOT NULL
RETURN labels(n)[1] AS type, count(n) AS count
ORDER BY count DESC
```

---

## MCP Server

If the MCP server is running (`node codegraph/dist/mcp/mcp.server.js`), these tools are available:

| Tool | Use For |
|------|---------|
| `list_projects` | Get project name and ID |
| `search_codebase` | Natural language code search (uses embeddings) |
| `natural_language_to_cypher` | Ask structural questions in plain English |
| `impact_analysis` | Pre-built blast radius analysis |
| `traverse_from_node` | Walk the graph from a node |
| `detect_dead_code` | Find unused exports |
| `detect_duplicate_code` | Find near-duplicates by normalized hash |
| `save_session_bookmark` / `restore_session_bookmark` | Cross-session continuity |
| `save_session_note` / `recall_session_notes` | Persistent notes |
| `swarm_*` | Multi-agent coordination (task posting, claiming, signaling) |

MCP config for Claude Code:
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

**You don't need MCP to use the graph.** `cypher-shell` works from any terminal. MCP adds convenience tools like natural language search and pre-built impact analysis.

---

## Operations

### Parse + ingest a project:
```bash
cd codegraph && npx tsx parse-and-ingest.ts
```

### Full post-ingest pipeline (8 steps):
```bash
cd codegraph && bash post-ingest-all.sh
```
Steps: risk scoring → state edges → git frequency → POSSIBLE_CALL → virtual dispatch → registration properties → project node → embeddings

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

### Start Neo4j (after reboot):
```bash
sudo neo4j start
```

### Edit simulation (preview changes before applying):
```bash
cd codegraph && npx tsx edit-simulation.ts <file> <modified-file>
```
Shows diff against current graph: nodes added/removed/modified, broken callers, risk assessment (SAFE/CAUTION/DANGEROUS/CRITICAL). Use on CRITICAL/HIGH functions before committing.

### Temporal coupling (mine co-change patterns from git):
```bash
cd codegraph && npx tsx temporal-coupling.ts codegraph
```
Creates `CO_CHANGES_WITH` edges between files that always change together. Query hidden couplings (co-change but no import):
```cypher
MATCH (a:SourceFile {projectId: 'PID'})-[r:CO_CHANGES_WITH]->(b)
WHERE NOT (a)-[:IMPORTS]->(b) AND NOT (b)-[:IMPORTS]->(a)
RETURN a.filePath, b.filePath, r.coChangeCount
ORDER BY r.coChangeCount DESC LIMIT 10
```

### File watcher (incremental re-parse on save):
```bash
cd codegraph && npx tsx watch.ts codegraph
```
Watches for file changes and incrementally updates the graph (~600-800ms per change). Note: requires native Linux FS (inotify); won't get live events on WSL→NTFS cross-mounts.

---

## Rules

1. **Query before you edit.** Check blast radius on anything CRITICAL or HIGH.
2. **Check module-level variables** before adding state — it might already exist.
3. **fanInCount > 10 = widely used.** Signature changes affect many callers.
4. **Check READS_STATE/WRITES_STATE** before touching session/state handling.
5. **Inner functions** (`isInnerFunction=true`) are helpers inside parent functions — they have their own call graphs.
6. **100% coverage** — every declaration in the source is in the graph. If it's not in the graph, it's not in the code.
