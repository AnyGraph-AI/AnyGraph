# CodeGraph — Agent Instructions

## What This Is

CodeGraph is a Neo4j-backed code knowledge graph with an MCP server.
It parses TypeScript codebases into structural nodes and edges, computes risk scores,
and exposes tools that AI coding agents query BEFORE making edits.

## MCP Tools Reference

### Discovery
| Tool | Use When |
|------|----------|
| `list_projects` | First thing — get project name and ID |
| `test_neo4j_connection` | Verify graph is reachable |

### Search & Navigate
| Tool | Use When |
|------|----------|
| `search_codebase` | Find code by natural language description |
| `natural_language_to_cypher` | Complex structural queries ("what calls X", "what implements Y") |
| `traverse_from_node` | Explore connections from a known node ID |

### Risk Assessment (USE THESE BEFORE EDITING)
| Tool | Use When |
|------|----------|
| `impact_analysis` | **Before any edit** — check blast radius and risk level |
| `detect_dead_code` | Before refactoring — don't touch dead code |
| `detect_duplicate_code` | Before writing new code — check if it exists |

### Session Continuity
| Tool | Use When |
|------|----------|
| `save_session_bookmark` | Save your working context before stopping |
| `restore_session_bookmark` | Resume work from a previous session |
| `save_session_note` | Record architectural decisions, risks, bugs |
| `recall_session_notes` | Search saved notes by topic or semantics |

### Multi-Agent Coordination (Swarm)
| Tool | Use When |
|------|----------|
| `swarm_post_task` | Post work items for other agents |
| `swarm_claim_task` | Pick up available work |
| `swarm_complete_task` | Mark work done |
| `swarm_pheromone` | Signal what you're working on (prevents conflicts) |
| `swarm_sense` | See what other agents are doing |
| `swarm_message` | Direct agent-to-agent communication |

## Mandatory Workflow

### Before Modifying Any Function

```
1. search_codebase({ query: "<what you're looking for>", projectId: "<name>" })
   → Get the node ID

2. impact_analysis({ projectId: "<name>", nodeId: "<id>" })
   → Check riskLevel: LOW / MEDIUM / HIGH / CRITICAL
   → Review affectedFiles list
   → Read criticalPaths

3. IF risk is HIGH or CRITICAL:
   - List ALL affected files
   - Plan changes across the full dependency chain
   - Consider saving a session_note about the risk

4. Make your edit

5. IF you changed exports, interfaces, or function signatures:
   - Re-check impact_analysis on the changed node
   - Verify downstream callers still compile
```

### Before Refactoring

```
1. detect_dead_code({ projectId: "<name>", filterCategory: "internal-unused" })
   → Remove dead code BEFORE restructuring

2. detect_duplicate_code({ projectId: "<name>", minSimilarity: 0.85 })
   → Consolidate duplicates instead of creating more

3. natural_language_to_cypher({ query: "functions with riskLevel > 500", projectId: "<name>" })
   → Identify CRITICAL-risk nodes to handle carefully
```

## Risk Tiers

Pre-computed on every Function/Method node:

| Tier | riskLevel | Meaning |
|------|-----------|---------|
| CRITICAL | > 500 | God functions, high fan-in × fan-out × complexity. Plan carefully. |
| HIGH | 100-500 | Core logic. Check all dependents before editing. |
| MEDIUM | 10-100 | Standard functions. Normal caution. |
| LOW | < 10 | Leaf functions, utilities. Safe to edit. |

## Graph Schema

### Node Types
`SourceFile`, `Function`, `Method`, `Class`, `Interface`, `TypeAlias`,
`Parameter`, `Import`, `Variable`, `Property`

Framework-specific (Grammy):
`CallbackQueryHandler`, `CommandHandler`, `EventHandler`, `BotFactory`, `Middleware`, `Entrypoint`

### Edge Types
- `CALLS` — function invocation (1,433 edges typical)
- `CONTAINS` — parent→child containment
- `HAS_PARAMETER` — function→parameter
- `RESOLVES_TO` — import symbol→canonical declaration (cross-file)
- `REGISTERED_BY` — handler→entrypoint registration
- `IMPORTS` — file-level import relationships
- `HAS_MEMBER` — class/interface→member

### Key Properties
- `riskLevel` (float) — pre-computed risk score
- `riskTier` (string) — LOW/MEDIUM/HIGH/CRITICAL
- `fanInCount` (int) — how many things call this
- `fanOutCount` (int) — how many things this calls
- `lineCount` (int) — lines of code
- `sourceCode` (string) — full source text
- `filePath` (string) — file location
- `embedding` (float[]) — 3072-dim vector for semantic search

## Operational Notes

- Neo4j: `bolt://localhost:7687`, auth `neo4j`/`codegraph`
- APOC plugin installed (416 functions)
- Vector index: `embedded_nodes_idx` (cosine similarity, 3072 dimensions)
- Re-parse + re-ingest: `cd codegraph && npx tsx parse-and-ingest.ts`
- Re-embed after re-ingest: `cd codegraph && npx tsx embed-nodes.ts`
- MCP server: `node codegraph/dist/mcp/mcp.server.js`
- NL→Cypher needs ~20s init on cold start (creates OpenAI assistant)
