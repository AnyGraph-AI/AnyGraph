# CodeGraph — Agent Skill

## What This Is

CodeGraph is a Neo4j code knowledge graph. Every function, class, method, variable, import, and call relationship in the codebase is a node or edge with risk scores, fan-in/fan-out counts, and state access tracking.

**You query the graph before you edit. That's the rule.**

## Connection

```bash
cypher-shell -u neo4j -p codegraph "YOUR CYPHER QUERY"
```

Or use the MCP tools if available (see below).

## The Pre-Edit Protocol

### Before editing ANY function:

1. **Call `pre_edit_check`** (MCP) or run this query:
```cypher
MATCH (f {projectId: 'PROJECT_ID'})
WHERE (f:Function OR f:Method) AND f.name = 'FUNCTION_NAME'
OPTIONAL MATCH (caller)-[:CALLS]->(f)
RETURN f.riskTier, f.riskLevel, f.fanInCount, f.fanOutCount, f.lineCount, f.isExported,
       collect(DISTINCT caller.name) AS calledBy
```

2. **If CRITICAL or HIGH risk** → call `simulate_edit` with your modified file content BEFORE writing the file. This shows exactly what breaks.

3. **If MEDIUM risk** → review the callers list. Understand who depends on this function.

4. **If LOW risk** → proceed.

### Verdicts

| Verdict | Risk Tier | Fan-in | Action |
|---------|-----------|--------|--------|
| SIMULATE_FIRST | CRITICAL/HIGH | >15 | MUST call simulate_edit before writing |
| PROCEED_WITH_CAUTION | MEDIUM | 5-15 | Check callers, proceed carefully |
| SAFE | LOW | <5 | Edit freely |

## MCP Tools

If the MCP server is connected, use these tools:

| Tool | When to Use |
|------|-------------|
| `pre_edit_check` | **ALWAYS** before editing a function. Returns verdict. |
| `simulate_edit` | When pre_edit_check says SIMULATE_FIRST. Shows graph delta. |
| `impact_analysis` | Deep blast radius analysis with transitive dependents. |
| `search_codebase` | Find functions by natural language description. |
| `traverse_from_node` | Walk the graph from a specific node. |
| `detect_dead_code` | Find unused exports. |
| `list_projects` | See what projects are in the graph. |
| `natural_language_to_cypher` | Ask structural questions in plain English. |

## Essential Cypher Queries

### Blast radius:
```cypher
MATCH (f:Function {name: 'NAME', projectId: 'PID'})
OPTIONAL MATCH (caller)-[:CALLS]->(f)
OPTIONAL MATCH (f)-[:CALLS]->(callee)
OPTIONAL MATCH (f)-[:READS_STATE]->(r:Field)
OPTIONAL MATCH (f)-[:WRITES_STATE]->(w:Field)
RETURN f.riskTier, collect(DISTINCT caller.name) AS calledBy,
       collect(DISTINCT callee.name) AS calls,
       collect(DISTINCT r.name) AS readsState,
       collect(DISTINCT w.name) AS writesState
```

### Who else writes the same state:
```cypher
MATCH (f)-[:WRITES_STATE]->(field:Field {name: 'FIELD_NAME', projectId: 'PID'})
RETURN f.name AS writer, f.filePath
```

### Files affected by a change:
```cypher
MATCH (changed:SourceFile {name: 'FILE.ts', projectId: 'PID'})
MATCH (dep:SourceFile)-[:IMPORTS]->(changed)
RETURN dep.name AS dependentFile
```

### Riskiest functions:
```cypher
MATCH (f {projectId: 'PID'})
WHERE (f:Function OR f:Method) AND f.riskTier IN ['CRITICAL', 'HIGH']
RETURN f.name, f.riskTier, f.riskLevel, f.fanInCount, f.filePath
ORDER BY f.riskLevel DESC LIMIT 20
```

### Hidden dependencies (temporal coupling):
```cypher
MATCH (a:SourceFile {projectId: 'PID'})-[r:CO_CHANGES_WITH]->(b)
WHERE NOT (a)-[:IMPORTS]->(b) AND NOT (b)-[:IMPORTS]->(a)
RETURN a.filePath, b.filePath, r.coChangeCount
ORDER BY r.coChangeCount DESC LIMIT 10
```

## Graph Schema (Quick Reference)

**Node types:** Function, Method, Class, Interface, TypeAlias, Variable, Property, Parameter, Import, SourceFile, Field, Entrypoint

**Edge types:** CALLS, CONTAINS, IMPORTS, RESOLVES_TO, REGISTERED_BY, READS_STATE, WRITES_STATE, POSSIBLE_CALL, CO_CHANGES_WITH, HAS_PARAMETER, HAS_MEMBER

**Key properties on nodes:** `riskLevel`, `riskTier` (LOW/MEDIUM/HIGH/CRITICAL), `fanInCount`, `fanOutCount`, `lineCount`, `isExported`, `isInnerFunction`, `sourceCode`, `filePath`

**Key properties on CALLS edges:** `conditional`, `conditionalKind`, `isAsync`, `crossFile`, `resolutionKind`

## Rules

1. **ALWAYS call pre_edit_check before editing a function.** No exceptions.
2. **If verdict is SIMULATE_FIRST, you MUST simulate before writing.** No shortcuts.
3. **fanInCount > 10 = widely used.** Signature changes affect many callers.
4. **Check READS_STATE/WRITES_STATE** before modifying state handling.
5. **Inner functions** (`isInnerFunction=true`) have their own call graphs — check them too.
6. **100% coverage** — every declaration in the source is in the graph.
