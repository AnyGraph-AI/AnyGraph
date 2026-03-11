# CodeGraph

A Neo4j code knowledge graph that gives AI coding agents structural awareness before they edit. Parses TypeScript codebases into nodes (every function, class, method, variable, import, type) and edges (calls, imports, containment, state access, temporal coupling, ownership, architecture layers). Pre-computes risk scores, blast radius, and change impact.

**The thesis:** AI agents break things because they can't see the full dependency web. CodeGraph makes hidden connections queryable — the same way a document investigation graph makes hidden relationships in a corpus queryable.

## Quick Start

### Prerequisites
- Node.js 22+
- Neo4j (installed natively on WSL, not Docker)
- `npm install` in this directory

### Start Neo4j
```bash
sudo neo4j start
```
Auth: `neo4j` / `codegraph` — `bolt://localhost:7687`

### Graph a TypeScript project

**Step 1: Create a tsconfig.json** in the target project (if it doesn't have one):
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "esModuleInterop": true,
    "strict": false,
    "skipLibCheck": true,
    "outDir": "dist"
  },
  "include": ["src/**/*.ts"]
}
```

**Step 2: Edit `parse-and-ingest.ts`** — update the project path, ID, and tsconfig location. Or create a new script:
```typescript
import { TypeScriptParser } from './src/core/parsers/typescript-parser.js';
import { CORE_TYPESCRIPT_SCHEMA } from './src/core/config/schema.js';

const PROJECT_PATH = '/path/to/your/project/';
const PROJECT_ID = 'proj_your_project_id';
const TSCONFIG = 'tsconfig.json';

const parser = new TypeScriptParser(PROJECT_PATH, TSCONFIG, CORE_TYPESCRIPT_SCHEMA, [], undefined, PROJECT_ID);
await parser.parseWorkspace();
const { nodes, edges } = parser.exportToJson();
// ... ingest to Neo4j (see parse-and-ingest.ts for full pipeline)
```

**Step 3: Run the parser + ingest:**
```bash
cd codegraph && npx tsx parse-and-ingest.ts
```

**Step 4: Run post-ingest enrichment (15 steps):**
```bash
cd codegraph && bash post-ingest-all.sh
```
This adds: risk scoring, state edges, git frequency, POSSIBLE_CALL, virtual dispatch, registration properties, project node, author ownership, architecture layers, riskLevel v2 promotion, provenance + confidence, unresolved reference nodes, audit subgraph, test coverage mapping, embeddings.

**Step 5: Query the graph:**
```bash
cypher-shell -u neo4j -p codegraph "MATCH (p:Project) RETURN p.name, p.nodeCount, p.edgeCount"
```

### Graph CodeGraph itself (self-graph)
```bash
cd codegraph && npx tsx parse-and-ingest-self.ts
```

## What's In The Graph

### Node Types (15)
| Type | What It Represents |
|------|-------------------|
| `SourceFile` | A `.ts` file |
| `Function` | Named function (top-level or inner) |
| `Method` | Class method |
| `Class` | Class declaration |
| `Interface` | Interface declaration |
| `TypeAlias` | `type X = ...` |
| `Variable` | const/let/var (exported AND non-exported) |
| `Property` | Class property |
| `Parameter` | Function/method parameter |
| `Import` | Import statement |
| `Field` | Tracked state field (e.g., `ctx.session.pendingBuy`) |
| `Entrypoint` | Framework registration (command, callback, event) |
| `Author` | Git author (from `git blame`) |
| `ArchitectureLayer` | Inferred layer (Presentation, Domain, Data, etc.) |
| `Project` | Top-level project with stats |

### Edge Types (13)
| Edge | Meaning |
|------|---------|
| `CALLS` | Function invocation (with conditional, isAsync, crossFile, resolutionKind) |
| `CONTAINS` | Parent → child |
| `IMPORTS` | File-level import (with dynamic flag) |
| `RESOLVES_TO` | Import symbol → canonical declaration |
| `REGISTERED_BY` | Handler → entrypoint |
| `READS_STATE` / `WRITES_STATE` | Function → state Field |
| `POSSIBLE_CALL` | Dynamic dispatch (with confidence) |
| `CO_CHANGES_WITH` | Temporal coupling from git (with coChangeCount, strength) |
| `OWNED_BY` | SourceFile → Author |
| `BELONGS_TO_LAYER` | SourceFile → ArchitectureLayer |
| `HAS_PARAMETER` | Function → Parameter |
| `HAS_MEMBER` | Class/Interface → Method/Property |

### Key Properties
- `riskLevel` / `riskTier` (LOW/MEDIUM/HIGH/CRITICAL) — pre-computed risk score
- `riskLevel` — risk with temporal coupling + author entropy baked in
- `fanInCount` / `fanOutCount` — caller/callee counts
- `sourceCode` — full source text (read implementations without opening files)
- `authorEntropy` — number of distinct git authors (fragmented ownership)
- `architectureLayer` — inferred from directory structure
- `gitChangeFrequency` — 0.0-1.0, how often the file changes

## MCP Server

29 tools available via MCP:

```bash
# Start the server
node codegraph/dist/mcp/mcp.server.js

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

### Core Tools
| Tool | Purpose |
|------|---------|
| `pre_edit_check` | **Gate.** Call before editing any function. Returns verdict. |
| `simulate_edit` | Preview graph delta of a change before applying it. |
| `impact_analysis` | Deep blast radius with transitive dependents. |
| `search_codebase` | Natural language search (vector embeddings). |
| `natural_language_to_cypher` | Ask questions in English → Cypher. |
| `traverse_from_node` | Walk the graph from a node. |
| `detect_dead_code` | Find unused exports. |
| `swarm_graph_refresh` | Re-parse changed files after edits. |

### Swarm Tools (multi-agent coordination)
| Tool | Purpose |
|------|---------|
| `swarm_post_task` | Post task with dependencies, context, priority. |
| `swarm_claim_task` | Claim a pending task. Returns unread messages. |
| `swarm_complete_task` | Complete/fail/request_review/approve/reject. |
| `swarm_get_tasks` | Query tasks by status/agent/swarm. |
| `swarm_message` | Agent-to-agent messaging (blocked/conflict/alert/handoff). |
| `swarm_pheromone` | Deposit coordination signals on nodes. |
| `swarm_sense` | Read pheromones near a node. |
| `swarm_graph_refresh` | Re-parse after edits so next agent has fresh data. |

## Agent Workflows

### For coding agents editing this codebase
Read `AGENTS.md` — full schema, queries, pre-edit protocol.

### For coding agents editing any CodeGraph-tracked project
Read `SKILL.md` — universal agent skill with pre-edit gate, query cookbook, decision tables.

### For multi-agent refactoring swarms
Read `swarm/COORDINATOR.md` (decomposition algorithm) + `swarm/WORKER.md` (worker protocol).

## Operations

| Command | What It Does |
|---------|-------------|
| `npx tsx parse-and-ingest.ts` | Parse GodSpeed + ingest to Neo4j |
| `npx tsx parse-and-ingest-self.ts` | Parse CodeGraph itself (self-graph) |
| `bash post-ingest-all.sh` | Run all 10 post-ingest enrichment passes |
| `npx tsx edit-simulation.ts <file> <modified>` | Preview graph delta |
| `npx tsx temporal-coupling.ts codegraph` | Mine git co-change patterns |
| `npx tsx seed-author-ownership.ts codegraph` | Git blame → Author nodes |
| `npx tsx seed-architecture-layers.ts codegraph` | Directory → layer classification |
| `npx tsx seed-git-frequency.ts` | Git log → change frequency |
| `npx tsx watch.ts codegraph` | File watcher (incremental re-parse) |
| `npx tsx compute-reparse-set.ts FILE.ts` | What files need reparsing if X changes |
| `npx tsx verify-completeness.ts` | Verify 100% declaration coverage |
| `npx vitest run tests/graph-integrity.test.ts` | Run 19 integrity tests |
| `npx tsx embed-nodes.ts` | Generate OpenAI embeddings for all nodes |

## Current Graphs

| Project | ID | Nodes | Edges | Files |
|---------|-----|-------|-------|-------|
| GodSpeed (Telegram trading bot) | `proj_60d5feed0001` | 2,095 | 4,458 | 36 |
| CodeGraph (self-graph) | `proj_c0d3e9a1f200` | 2,107 | 3,468 | 95 |

Both coexist in the same Neo4j instance, separated by `projectId`.

## Extending to Non-Code Corpora

The graph schema is general. The same architecture can graph any structured corpus:

| Code Concept | Corpus Equivalent |
|-------------|-------------------|
| Function | Document / Entity |
| CALLS | REFERENCES / MENTIONS |
| IMPORTS | CITES / LINKS_TO |
| CONTAINS | SECTION_OF / PART_OF |
| Field | Metadata field / Tag |
| READS_STATE / WRITES_STATE | USES_CONCEPT / DEFINES_CONCEPT |
| CO_CHANGES_WITH | CO_OCCURS_WITH |
| OWNED_BY | AUTHORED_BY |
| ArchitectureLayer | Category / Topic |
| riskLevel | Importance / Centrality score |

To graph a corpus:
1. Write a parser that emits nodes and edges in the same JSON format as the TypeScript parser
2. Use `ingest-to-neo4j.ts` to load into Neo4j (it's schema-agnostic — it just reads nodes/edges arrays)
3. Write post-ingest enrichment passes for your domain (risk scoring, co-occurrence, authorship)
4. The MCP tools (`search_codebase`, `traverse_from_node`, `impact_analysis`) work on any graph shape

The GOYFILES investigation graph (Epstein document corpus) is the proof that this pattern works at scale: 200K+ nodes, millions of edges, same Neo4j + agent + query pattern.

## Architecture

```
codegraph/
├── src/
│   ├── core/
│   │   ├── parsers/          # ts-morph TypeScript parser (the engine)
│   │   ├── config/           # Schema definitions + framework schemas
│   │   ├── embeddings/       # OpenAI embeddings + NL→Cypher
│   │   ├── utils/            # File change detection, graph factory
│   │   └── workspace/        # Project detection
│   ├── mcp/
│   │   ├── tools/            # 33 MCP tools
│   │   ├── handlers/         # Graph generation, traversal, incremental parse
│   │   ├── services/         # Watch manager, job manager
│   │   └── mcp.server.ts     # MCP server entry point
│   └── storage/
│       └── neo4j/            # Neo4j service + queries
├── swarm/
│   ├── COORDINATOR.md        # Multi-agent coordinator protocol
│   └── WORKER.md             # Worker protocol
├── AGENTS.md                 # Agent instructions for editing CodeGraph
├── SKILL.md                  # Universal agent skill for any project
├── PLAN.md                   # Architecture plan + design decisions
├── parse-and-ingest.ts       # GodSpeed parser + ingest script
├── parse-and-ingest-self.ts  # Self-graph script
├── post-ingest-all.sh        # 10-step enrichment pipeline
├── edit-simulation.ts        # Delta graph preview
├── temporal-coupling.ts      # Git co-change mining
├── seed-author-ownership.ts  # Git blame → Author nodes
├── seed-architecture-layers.ts # Directory → layer classification
├── verify-completeness.ts    # Declaration coverage verification
└── .codegraph.yml            # Project-specific config (framework, state roots, risk)
```

## Tech Stack

- **Parser**: ts-morph (semantic TypeScript parsing — resolves types, not just syntax)
- **Graph**: Neo4j + APOC (same as GOYFILES investigation graph)
- **MCP**: @modelcontextprotocol/sdk (29 tools)
- **Embeddings**: OpenAI text-embedding-3-large (optional, for semantic search)
- **NL→Cypher**: OpenAI gpt-4o (optional, for natural language queries)
- **Tests**: Vitest (19 integrity tests)
- **File watching**: @parcel/watcher (native inotify)

## Key Design Decisions

- **ts-morph over tree-sitter**: Semantic type resolution catches what syntax-only parsing misses
- **Forked from drewdrewH/code-graph-context v2.9.0**: Gave us ~60% of Phase 1 for free
- **Pre-computed risk scores**: Agents check one property, not run a scoring query every time
- **Edit simulation before writing**: Shows exactly what breaks, not just what might
- **Graph informs, not gatekeeps**: SKILL.md sets expectations, no compliance theater
- **100% declaration coverage**: Every const, let, var, function, class in source = a node
- **Separate projectId**: Multiple codebases coexist in one Neo4j instance
