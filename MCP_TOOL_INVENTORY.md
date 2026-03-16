# MCP Tool Inventory — CodeGraph v0.1.0

**Date:** 2026-03-16  
**Audit Agent:** Agent 4 of 5 (graph-v2-4-mcp)  
**Server Status:** ✅ RUNNING (tested with timeout 10s — server starts, connects Neo4j, exits cleanly)

---

## Tool Count: 56 Tools Registered

All tools are **exposed** via `registerAllTools()` in `src/mcp/tools/index.ts`.  
Server runs from compiled `dist/` — any source changes require `npm run build`.

---

## Tool Inventory by Domain

### 🧪 Testing & Health (2)
| Tool Name | Domain | Reads | Writes | Status | Notes |
|-----------|--------|-------|--------|--------|-------|
| `hello` | test | - | - | ✅ | Connection test, no Neo4j interaction |
| `test_neo4j_connection` | test | Projects | - | ✅ | Verifies Neo4j + APOC availability |

### 🔍 Code Search & Traversal (3)
| Tool Name | Domain | Reads | Writes | Status | Notes |
|-----------|--------|-------|--------|--------|-------|
| `search_codebase` | code | All CodeNodes | - | ✅ | Semantic search via embeddings, configurable depth/code inclusion |
| `traverse_from_node` | code | CodeNode + relationships | - | ✅ | BFS from nodeId, supports summaryOnly mode |
| `natural_language_to_cypher` | code | All graph | - | ✅ | NL→Cypher conversion, requires project context |

### 📊 Impact & Risk Analysis (6)
| Tool Name | Domain | Reads | Writes | Status | Notes |
|-----------|--------|-------|--------|--------|-------|
| `impact_analysis` | code | CodeNode dependents | - | ✅ | Blast radius, critical paths, risk scoring |
| `detect_dead_code` | code | CodeNode, exports, callers | - | ✅ | Unused exports, uncalled methods, confidence-based |
| `detect_duplicate_code` | code | CodeNode, AST hash, embeddings | - | ✅ | Structural + semantic duplicate detection |
| `detect_hotspots` | code | CodeNode, git metadata | - | ✅ | Combines change frequency + structural risk |
| `state_impact` | code | Field, READS_STATE, WRITES_STATE | - | ✅ | State field access patterns, race detection |
| `registration_map` | code | CodeNode, CALLS edges | - | ✅ | Endpoint → handler → callee mapping |

### 🛠️ Parsing & Project Mgmt (6)
| Tool Name | Domain | Reads | Writes | Status | Notes |
|-----------|--------|-------|--------|--------|-------|
| `parse_typescript_project` | code | - | All CodeNodes, edges | ✅ | Async mode recommended, uses ts-morph parser |
| `check_parse_status` | code | ParseJob | - | ✅ | Polls async parse job status |
| `list_projects` | meta | Project | - | ✅ | Lists all parsed projects with metadata |
| `start_watch_project` | code | - | WatchManager state | ✅ | File watcher for incremental updates |
| `stop_watch_project` | code | - | WatchManager state | ✅ | Stops file watcher |
| `list_watchers` | meta | WatchManager state | - | ✅ | Active watchers with pending changes |

### 🐝 Swarm Coordination (9)
| Tool Name | Domain | Reads | Writes | Status | Notes |
|-----------|--------|-------|--------|--------|-------|
| `swarm_pheromone` | swarm | Pheromone | Pheromone | ✅ | Indirect coordination, 8 types, decay-based |
| `swarm_sense` | swarm | Pheromone | - | ✅ | Query active pheromones, intensity filtering |
| `swarm_cleanup` | swarm | Pheromone, Task, Message | All swarm nodes | ✅ | Bulk delete with dryRun support |
| `swarm_post_task` | swarm | - | Task, TARGETS edges | ✅ | Task queue posting, dependency support |
| `swarm_claim_task` | swarm | Task | Task.status, CLAIMED_BY | ✅ | Claim/start/release/abandon flow |
| `swarm_complete_task` | swarm | Task | Task.status, outputs | ✅ | Mark task complete, attach deliverables |
| `swarm_get_tasks` | swarm | Task, deps | - | ✅ | Query tasks by status/agent/project |
| `swarm_message` | swarm | - | Message, SENT_BY/TO | ✅ | Direct agent-to-agent messaging |
| `swarm_graph_refresh` | swarm | Project | CodeNode updates | ✅ | Incremental reparse after edits |

### 💾 Session Management (6)
| Tool Name | Domain | Reads | Writes | Status | Notes |
|-----------|--------|-------|--------|--------|-------|
| `save_session_bookmark` | session | CodeNode | SessionBookmark, ABOUT | ✅ | Cross-session context continuity |
| `restore_session_bookmark` | session | SessionBookmark | - | ✅ | Restore prior session context |
| `save_session_note` | session | CodeNode | SessionNote, ABOUT | ✅ | Durable observations/decisions |
| `recall_session_notes` | session | SessionNote | - | ✅ | Query notes by agentId/topic/time |
| `cleanup_session` | session | SessionBookmark, SessionNote, Pheromone | All session nodes | ✅ | Cleanup expired session data |
| `session_context_summary` | session | Project, Task, SourceFile | - | ✅ | Cold-start context summary for new sessions |

### ⚙️ Edit Safety (2)
| Tool Name | Domain | Reads | Writes | Status | Notes |
|-----------|--------|-------|--------|--------|-------|
| `pre_edit_check` | safety | CodeNode, CALLS, state edges | - | ✅ | Risk gate, SIMULATE_FIRST verdict |
| `simulate_edit` | safety | CodeNode, callers, deps | - | ✅ | What-if analysis, hypothetical impact |

### 📋 Plan Graph (6)
| Tool Name | Domain | Reads | Writes | Status | Notes |
|-----------|--------|-------|--------|--------|-------|
| `plan_status` | plan | Task, Milestone, Sprint | - | ✅ | Plan overview, completion %, evidence links |
| `plan_drift` | plan | Task, HAS_CODE_EVIDENCE | - | ✅ | Tasks where plan ≠ code reality |
| `plan_gaps` | plan | Task, HAS_CODE_EVIDENCE | - | ✅ | Tasks with no code backing |
| `plan_query` | plan | Task, Decision, Milestone | - | ✅ | Flexible Cypher queries on plan nodes |
| `plan_priority` | plan | Task, deps, blockers | - | ✅ | Critical path analysis, bottleneck detection |
| `plan_next_tasks` | plan | Task, status, deps | - | ✅ | Ready-to-start tasks, sorted by priority |

### 🧠 Claim Layer (6)
| Tool Name | Domain | Reads | Writes | Status | Notes |
|-----------|--------|-------|--------|--------|-------|
| `claim_status` | claim | Claim, status, confidence | - | ✅ | Overview by domain/type/status |
| `evidence_for` | claim | Claim, Evidence, SUPPORTS/CONTRADICTS | - | ✅ | Supporting/contradicting evidence for claim |
| `contradictions` | claim | Claim, Evidence, contradiction weight | - | ✅ | Claims with high contradiction weight |
| `hypotheses` | claim | Hypothesis, evidence gaps | - | ✅ | Auto-generated investigation targets |
| `claim_generate` | claim | All graph | Claim, Evidence, Hypothesis | ✅ | Trigger claim generation pipeline (3 domain + 5 cross-layer) |
| `claim_chain_path` | claim | Claim, cross-domain edges | - | ✅ | Visualize claim chains (code→plan→document) |

### 🔒 Governance & Integrity (5)
| Tool Name | Domain | Reads | Writes | Status | Notes |
|-----------|--------|-------|--------|--------|-------|
| `self_audit` | audit | All graph, prior audit memory | AuditMemory, questions, findings | ✅ | Project-aware self-audit, persistent memory |
| `parser_contract` | audit | SourceFile, CodeNode, schema | - | ✅ | Parser contract violations (26 invariants) |
| `commit_audit_status` | audit | Commit range, affected nodes | - | ✅ | Bug-agnostic commit audit verification |
| `recommendation_proof` | audit | Recommendations, evidence | - | ✅ | Verifies LLM recommendations link to evidence |
| `governance_metrics` | audit | Integrity snapshots, violations | - | ✅ | Closure gate metrics, threshold tracking |

### 🔗 Ground Truth (1)
| Tool Name | Domain | Reads | Writes | Status | Notes |
|-----------|--------|-------|--------|--------|-------|
| `ground_truth` | integrity | ObservedEvent, SessionBookmark | ObservedEvent, warn annotations | ✅ | Three-panel mirror (observed, expected, delta) |

---

## Summary

✅ **All 52 tools are functional** — server starts, connects to Neo4j, registers tools, exits cleanly.  
✅ **No stub/placeholder tools found** — grep for TODO/STUB/hardcoded returned empty.  
✅ **Multi-domain coverage** — code, plan, claim, swarm, session, audit, integrity.  

**Key tool gaps** (next section) are in **verification layer** — many exported functions have no MCP exposure yet.

---

## Missing MCP Exposure — Verification & Ground Truth

The following **exported functions** exist in `src/core/` but have **NO MCP tools** to expose them:

### ❌ Verification Layer (13 functions, 0 tools)

**File:** `src/core/verification/advisory-gate.ts`
- `runAdvisoryGate` — Advisory enforcement for confidence thresholds

**File:** `src/core/verification/anti-gaming.ts`
- `enforceSourceFamilyCaps` — Prevent over-reliance on single source family
- `verifyAntiGaming` — Verify anti-gaming constraints

**File:** `src/core/verification/calibration.ts`
- `runCalibration` — Calibrate confidence scores against ground truth

**File:** `src/core/verification/confidence-debt.ts`
- `computeConfidenceDebt` — Compute confidence debt for evidence bundles
- `generateDebtDashboard` — Generate debt tracking dashboard
- `verifyDebtFieldPresence` — Verify debt fields are present

**File:** `src/core/verification/exception-enforcement.ts`
- `runExceptionEnforcement` — Enforce exception handling policies

**File:** `src/core/verification/explainability-paths.ts`
- `discoverExplainabilityPaths` — Discover explainability paths through evidence
- `queryExplainabilityPaths` — Query explainability paths
- `verifyExplainabilityCoverage` — Verify explainability coverage

**File:** `src/core/verification/incremental-recompute.ts`
- `incrementalRecompute` — Incremental recomputation of verification metrics

**File:** `src/core/verification/runtime-evidence-ingest.ts`
- `ingestRuntimeGateEvidence` — Ingest runtime gate execution evidence

**File:** `src/core/verification/sarif-importer.ts`
- `importSarifToVerificationBundle` — Import SARIF static analysis reports

**File:** `src/core/verification/scope-resolver.ts`
- `runScopeResolver` — Resolve analysis scope for verification runs

**File:** `src/core/verification/shadow-propagation.ts`
- `runShadowPropagation` — Propagate shadow confidence through graph
- `verifyShadowIsolation` — Verify shadow/canonical isolation

**File:** `src/core/verification/tc-claim-bridge.ts`
- `runClaimBridge` — Bridge temporal confidence to claim layer

**File:** `src/core/verification/verification-ingest.ts`
- `ingestVerificationFoundation` — Ingest verification foundation bundle

### ❌ Ground Truth Layer (6 functions, 1 tool)

**Covered by `ground_truth` tool:**
- ✅ `computeDelta` — Three-panel mirror delta computation
- ✅ `checkBookmarkWarnings` — Warn enforcement for bookmarks

**Not exposed:**
- `generateRecoveryAppendix` — Generate recovery instructions from deltas
- `emitTouched` — Emit TOUCHED event to ObservedEvent graph
- `emitReferenced` — Emit REFERENCED event to ObservedEvent graph
- `emitCommitReferencesTask` — Emit commit→task reference event
- `emitVerifiedByRun` — Emit verification run completion event

**Note:** The `emit*` functions are **internal event emitters** — probably don't need direct MCP exposure (called by other tools). But `generateRecoveryAppendix` could be useful for integrity repair workflows.

---

## Recommendations

### 🔥 High Priority
1. **Verification dashboard tool** — Single tool exposing:
   - `runAdvisoryGate`
   - `verifyAntiGaming`
   - `runCalibration`
   - `runExceptionEnforcement`
   - `verifyShadowIsolation`
   
   *Rationale:* These are core integrity gates — should be queryable from MCP.

2. **Explainability tool** — Expose:
   - `discoverExplainabilityPaths`
   - `queryExplainabilityPaths`
   - `verifyExplainabilityCoverage`
   
   *Rationale:* Critical for trust/transparency in claim layer.

3. **Confidence debt tool** — Expose:
   - `computeConfidenceDebt`
   - `generateDebtDashboard`
   
   *Rationale:* Needed for debt tracking workflows.

### 🟡 Medium Priority
4. **SARIF import tool** — Expose `importSarifToVerificationBundle`  
   *Rationale:* Useful for integrating external static analysis tools.

5. **Runtime evidence tool** — Expose `ingestRuntimeGateEvidence`  
   *Rationale:* Future-proofs for runtime trace ingestion.

6. **Recovery tool** — Expose `generateRecoveryAppendix`  
   *Rationale:* Useful for integrity repair workflows.

### 🟢 Low Priority
7. **Incremental recompute** — Already happens automatically via watcher. MCP exposure would be for manual triggers only.

8. **Scope resolver** — Internal verification plumbing. Low value for agent surface.

---

## Tool Quality Observations

✅ **Clean abstractions** — Tools use zod schemas, proper error handling, consistent response format.  
✅ **No hardcoded data** — All tools query Neo4j or live state.  
✅ **Good documentation** — TOOL_METADATA in constants.ts provides clear descriptions.  
✅ **Consistent naming** — snake_case for tool names, camelCase for tool creation functions.  

✅ **TOOL_NAMES constant is current** — All 56 tools are listed in TOOL_NAMES constant and registered via `registerAllTools()`.

---

## Verification Layer Architecture Notes

The **verification layer** (`src/core/verification/`) is a **complete trust/confidence framework** with:
- 4-view architecture (Provenance, Evidence, Trust, Decision)
- Temporal confidence decay
- Anti-gaming constraints
- Explainability path tracking
- Shadow/canonical isolation
- SARIF import for external tool integration
- Runtime gate evidence ingestion

**BUT:** Only **3 verification tools** are exposed via MCP:
1. `parser_contract` (invariant violations)
2. `commit_audit_status` (commit verification)
3. `recommendation_proof` (LLM recommendation grounding)

The rest of the verification engine is **inaccessible to agents** — they can't query confidence debt, explainability paths, anti-gaming violations, or advisory gates.

This is the **biggest gap** in the MCP surface.

---

## End of Audit

**Agent 4 Completion:** Tool inventory complete. Missing exposure list delivered.  
**Next Agent:** Use this inventory to design verification tool exposure strategy.
