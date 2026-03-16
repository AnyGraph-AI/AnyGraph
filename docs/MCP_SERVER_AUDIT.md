# MCP Server Registration & Transport Audit
**Date:** 2026-03-16  
**Codebase:** `/home/jonathan/.openclaw/workspace/codegraph/`

---

## Executive Summary

- **56 tools defined** in constants (TOOL_NAMES)
- **56 tools registered** across 41 tool files
- **No name collisions** detected
- **Server uses stdio transport** (StdioServerTransport)
- **Startup successful** — Neo4j connects, tools register, graceful shutdown works
- **SCAR-007 issue confirmed**: hardcoded toolCount in mcp.server.ts (says 15, actual 56)

---

## 1. Tool Registration Architecture

### Registration Methods

Two registration patterns coexist:

1. **`server.registerTool(name, schema, handler)`** — 29 tools
   - Used by most single-tool files (hello, search, impact-analysis, etc.)
   - Example: `hello.tool.ts`, `search-codebase.tool.ts`

2. **`server.tool(name, description, schema, handler)`** — 27 tools
   - Used by multi-tool files and newer tools
   - Example: `verification-dashboard.tool.ts` (4 tools), `claim-tools.tool.ts` (6 tools)

Both methods are valid MCP SDK patterns. No functional difference.

### Registration Chain

```
mcp.server.ts (main entry)
  → registerAllTools(server) [tools/index.ts]
    → create*Tool(server) [52 create functions across 41 files]
      → server.tool() or server.registerTool() [56 actual registrations]
```

**Tool creation functions (52):**
- Most files export 1 create function that registers 1 tool
- Some files export multiple create functions:
  - `session-bookmark.tool.ts`: 2 functions (save + restore)
  - `session-note.tool.ts`: 2 functions (save + recall)
  - `plan-status.tool.ts`: 6 functions (status, drift, gaps, query, priority, next_tasks)
  - `claim-tools.tool.ts`: 6 functions (status, generate, chain, evidence, contradictions, hypotheses)
  - `verification-dashboard.tool.ts`: 1 function that registers 4 tools internally

---

## 2. Tool Inventory (56 Total)

### Tool Name List (from TOOL_NAMES constants)

```
hello
searchCodebase / search_codebase
naturalLanguageToCypher / natural_language_to_cypher
traverseFromNode / traverse_from_node
parseTypescriptProject / parse_typescript_project
testNeo4jConnection / test_neo4j_connection
impactAnalysis / impact_analysis
checkParseStatus / check_parse_status
listProjects / list_projects
startWatchProject / start_watch_project
stopWatchProject / stop_watch_project
listWatchers / list_watchers
detectDeadCode / detect_dead_code
detectDuplicateCode / detect_duplicate_code
swarmPheromone / swarm_pheromone
swarmSense / swarm_sense
swarmCleanup / swarm_cleanup
swarmPostTask / swarm_post_task
swarmClaimTask / swarm_claim_task
swarmCompleteTask / swarm_complete_task
swarmGetTasks / swarm_get_tasks
saveSessionBookmark / save_session_bookmark
restoreSessionBookmark / restore_session_bookmark
saveSessionNote / save_session_note
recallSessionNotes / recall_session_notes
cleanupSession / cleanup_session
swarmMessage / swarm_message
simulateEdit / simulate_edit
preEditCheck / pre_edit_check
swarmGraphRefresh / swarm_graph_refresh
groundTruth / ground_truth
planStatus / plan_status
planDrift / plan_drift
planGaps / plan_gaps
planNextTasks / plan_next_tasks
planPriority / plan_priority
planQuery / plan_query
claimStatus / claim_status
claimGenerate / claim_generate
claimChainPath / claim_chain_path
evidenceFor / evidence_for
contradictions / contradictions
hypotheses / hypotheses
commitAuditStatus / commit_audit_status
governanceMetricsStatus / governance_metrics_status
parserContractStatus / parser_contract_status
recommendationProofStatus / recommendation_proof_status
selfAudit / self_audit
detectHotspots / detect_hotspots
stateImpact / state_impact
registrationMap / registration_map
sessionContextSummary / session_context_summary
verificationDashboard / verification_dashboard
explainabilityPaths / explainability_paths
confidenceDebtDashboard / confidence_debt_dashboard
importSarif / import_sarif
```

### Tool Files (41 total)

```
check-parse-status.tool.ts: 1 registration
claim-tools.tool.ts: 6 registrations
commit-audit-status.tool.ts: 1 registration
detect-dead-code.tool.ts: 1 registration
detect-duplicate-code.tool.ts: 1 registration
detect-hotspots.tool.ts: 1 registration
governance-metrics.tool.ts: 1 registration
ground-truth.tool.ts: 1 registration
hello.tool.ts: 1 registration
impact-analysis.tool.ts: 1 registration
list-projects.tool.ts: 1 registration
list-watchers.tool.ts: 1 registration
natural-language-to-cypher.tool.ts: 1 registration
parse-typescript-project.tool.ts: 1 registration
parser-contract.tool.ts: 1 registration
plan-status.tool.ts: 6 registrations
pre-edit-check.tool.ts: 1 registration
recommendation-proof-status.tool.ts: 1 registration
registration-map.tool.ts: 1 registration
search-codebase.tool.ts: 1 registration
self-audit.tool.ts: 1 registration
session-bookmark.tool.ts: 2 registrations
session-cleanup.tool.ts: 1 registration
session-context-summary.tool.ts: 1 registration
session-note.tool.ts: 2 registrations
simulate-edit.tool.ts: 1 registration
start-watch-project.tool.ts: 1 registration
state-impact.tool.ts: 1 registration
stop-watch-project.tool.ts: 1 registration
swarm-claim-task.tool.ts: 1 registration
swarm-cleanup.tool.ts: 1 registration
swarm-complete-task.tool.ts: 1 registration
swarm-get-tasks.tool.ts: 1 registration
swarm-graph-refresh.tool.ts: 1 registration
swarm-message.tool.ts: 1 registration
swarm-pheromone.tool.ts: 1 registration
swarm-post-task.tool.ts: 1 registration
swarm-sense.tool.ts: 1 registration
test-neo4j-connection.tool.ts: 1 registration
traverse-from-node.tool.ts: 1 registration
verification-dashboard.tool.ts: 4 registrations
```

### Name Collision Check

**Result:** ✅ No collisions detected

All 56 tools have unique names. TOOL_NAMES constants have no duplicate values.

---

## 3. Transport Architecture

### Transport Type
**StdioServerTransport** — JSON-RPC over stdin/stdout

```typescript
const transport = new StdioServerTransport();
await server.connect(transport);
```

### Event Handling

Comprehensive stdio monitoring:
- `process.stdin` events: `close`, `end`, `error`
- `process.stdout` events: `close`, `error`
- All events logged to debug file for diagnostics

### Lifecycle Management

**Signal handling:**
- `SIGTERM` → graceful shutdown (stops watchers, closes Neo4j)
- `SIGINT` → **ignored** (logged but doesn't exit)
  - Rationale: "Claude Code may propagate SIGINT to child processes when spawning agents, which would incorrectly kill the MCP server. The MCP server lifecycle is managed by Claude Code via stdio transport closure."
- `SIGHUP` → **ignored** (logged)

**Exception handling:**
- `uncaughtException` → logged, server continues
- `unhandledRejection` → logged, server continues
- `warning` → logged
- `beforeExit` → stats logged
- `exit` → final message to stderr

**Intentional design:** Server does NOT exit on exceptions. Lifecycle is controlled by transport closure, not signals.

---

## 4. Startup Sequence

### What Happens on Startup

1. **Environment setup**
   - Load `.env` from project root (2 levels up from `dist/mcp/mcp.server.js`)
   - Uses `dotenv` with `quiet: true`

2. **Server creation**
   - `new McpServer({ name: 'codebase-graph', version: '1.0.0' })`

3. **Tool registration**
   - Calls `registerAllTools(server)`
   - 56 tools registered synchronously
   - **BUG**: hardcoded log says "toolCount: 15" (stale, should be 56)

4. **Watch manager configuration**
   - Sets incremental parse handler
   - Sets MCP server reference (for notifications)

5. **Service initialization** (async, non-blocking)
   - `initializeServices()` runs in background
   - Checks for `OPENAI_API_KEY` (warns if missing)
   - Connects to Neo4j (fatal if fails)
   - Initializes Neo4j schema cache (`neo4j-apoc-schema.json`)
   - Initializes NL→Cypher service (depends on schema)

6. **Transport connection**
   - Creates `StdioServerTransport`
   - Attaches stdio event listeners
   - Connects server to transport

7. **Ready state**
   - Logs "Server connected and ready"
   - Logs server stats (uptime, memory, pid)
   - Neo4j connection confirmed

### Startup Test Results

```bash
timeout 15 npx tsx src/mcp/mcp.server.ts
```

**Output:**
```json
{"level":"info","message":"Starting MCP server..."}
{"level":"info","message":"=== MCP Server Starting ==="}
{"level":"info","message":"Creating transport..."}
{"level":"info","message":"Connecting server to transport..."}
{"level":"info","message":"=== MCP Server Connected and Running ==="}
{"level":"info","message":"[code-graph-context] Neo4j connected successfully"}
{"level":"info","message":"Received SIGTERM, shutting down..."}
{"level":"info","message":"Process exiting with code 0"}
```

**Result:** ✅ Successful startup and graceful shutdown

- All services initialized
- Neo4j connected
- Transport established
- Clean shutdown after 15s timeout (SIGTERM)

---

## 5. Service Initialization (`service-init.ts`)

### Initialization Flow

```typescript
export const initializeServices = async (): Promise<void> => {
  await checkConfiguration();        // Warn if OPENAI_API_KEY missing
  await ensureNeo4j();                // Fatal if Neo4j unreachable
  await initializeNeo4jSchema();      // Cache schema from APOC
  await initializeNaturalLanguageService();  // Initialize NL→Cypher assistant
};
```

### Neo4j Connection

**Native install support** — no Docker required:
- Bolt URI: `process.env.NEO4J_URI ?? 'bolt://localhost:7687'`
- Auth: from env vars (NEO4J_USER, NEO4J_PASSWORD)
- Error message: "Ensure Neo4j is running (sudo neo4j start)"

### Schema Discovery

Two-tier schema caching:

1. **Raw APOC schema** — `CALL apoc.meta.schema()`
2. **Discovered schema** — queries actual graph contents:
   - Node types with sample properties
   - Relationship types with connection patterns
   - Semantic types (from `semanticType` property)
   - Common graph patterns (3-node chains)

Cached to: `neo4j-apoc-schema.json` in project root

### Error Handling

- Missing `OPENAI_API_KEY` → warning (non-fatal)
- Neo4j unreachable → throws error (fatal)
- Schema fetch failure → logged but not thrown (service continues)

---

## 6. Issues Found

### Issue 1: Stale Tool Count (SCAR-007 Adjacent)

**Location:** `mcp.server.ts:61`

```typescript
await debugLog('Tools registered', { toolCount: 15 });
```

**Problem:** Hardcoded count says 15, actual count is 56.

**Impact:** Low (doesn't affect functionality, only debug logs)

**Fix:** Calculate count dynamically or remove the log entirely.

**Suggested fix:**
```typescript
// Option 1: Count from TOOL_NAMES
import { TOOL_NAMES } from './constants.js';
const toolCount = Object.keys(TOOL_NAMES).length;
await debugLog('Tools registered', { toolCount });

// Option 2: Remove the count (server.listTools() provides this dynamically)
await debugLog('Tools registered');
```

### Issue 2: No Runtime Tool Count Verification

**Problem:** No verification that all 56 tools in TOOL_NAMES are actually registered.

**Risk:** If a tool is added to constants but not to `registerAllTools()`, it silently fails.

**Suggested improvement:**
```typescript
// At end of registerAllTools():
export const registerAllTools = (server: McpServer): void => {
  // ... all create*Tool calls ...

  // Verify all tools were registered
  const expectedCount = Object.keys(TOOL_NAMES).length;
  const registeredTools = server.listTools(); // hypothetical MCP SDK method
  if (registeredTools.length !== expectedCount) {
    throw new Error(
      `Tool registration mismatch: expected ${expectedCount}, got ${registeredTools.length}`
    );
  }
};
```

*(Note: Need to check if MCP SDK provides listTools() or similar)*

---

## 7. Architecture Strengths

### Clean Separation of Concerns

- **constants.ts**: All tool names and metadata centralized
- **tools/index.ts**: Single registration orchestrator
- **tools/*.tool.ts**: Individual tool implementations
- **service-init.ts**: External service bootstrapping
- **mcp.server.ts**: Transport and lifecycle only

### Robust Error Handling

- Non-blocking service init (doesn't crash on schema fetch failure)
- Comprehensive exception logging
- Graceful shutdown with cleanup
- Transport event monitoring

### Signal Handling Design

Smart decision to **ignore SIGINT**:
- Prevents accidental shutdown when Claude Code spawns/kills sub-agents
- Lifecycle tied to stdio transport closure (explicit, not signal-based)
- Only responds to SIGTERM (explicit termination request)

### Debug Infrastructure

- All events logged to `debug-search.log`
- Server stats tracking (uptime, memory, tool calls)
- Transport event logging
- Process warning/exit logging

---

## 8. Recommendations

### Short-term (Quick Fixes)

1. **Fix stale tool count log** — use `Object.keys(TOOL_NAMES).length`
2. **Add tool count verification** — assert expected == actual at registration time
3. **Document registration pattern** — add comment explaining why some tools use `.tool()` vs `.registerTool()`

### Medium-term (Maintainability)

1. **Auto-generate tool index** — script to scan tool files and generate imports/calls
2. **Tool registration test** — unit test that verifies all TOOL_NAMES are registered
3. **Schema validation** — verify tool input schemas match documented parameters

### Long-term (Observability)

1. **Tool usage metrics** — track which tools are called, how often, success rates
2. **Registration audit endpoint** — expose tool list via MCP for runtime inspection
3. **Health check tool** — diagnostic tool that verifies Neo4j, APOC, embeddings service

---

## Appendix: Full Tool List by Category

### Core Functionality (8)
- hello
- search_codebase
- natural_language_to_cypher
- traverse_from_node
- test_neo4j_connection
- impact_analysis
- detect_dead_code
- detect_duplicate_code

### Project Management (5)
- list_projects
- parse_typescript_project
- check_parse_status
- start_watch_project
- stop_watch_project
- list_watchers

### Swarm Coordination (13)
- swarm_pheromone
- swarm_sense
- swarm_cleanup
- swarm_post_task
- swarm_claim_task
- swarm_complete_task
- swarm_get_tasks
- swarm_message
- swarm_graph_refresh
- simulate_edit
- pre_edit_check

### Session Management (6)
- save_session_bookmark
- restore_session_bookmark
- save_session_note
- recall_session_notes
- cleanup_session
- session_context_summary

### Plan Graph (6)
- plan_status
- plan_drift
- plan_gaps
- plan_next_tasks
- plan_priority
- plan_query

### Claim Layer (6)
- claim_status
- claim_generate
- claim_chain_path
- evidence_for
- contradictions
- hypotheses

### Governance (5)
- commit_audit_status
- governance_metrics_status
- parser_contract_status
- recommendation_proof_status
- self_audit

### Analysis (3)
- detect_hotspots
- state_impact
- registration_map

### Verification (4)
- verification_dashboard
- explainability_paths
- confidence_debt_dashboard
- import_sarif

### Foundation (1)
- ground_truth

---

**Audit completed:** 2026-03-16 01:53 EDT  
**Total issues found:** 2 (both low severity)  
**Overall assessment:** ✅ Server architecture is solid, registration is complete and collision-free
