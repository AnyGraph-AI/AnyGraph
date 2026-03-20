# AnythingGraph — Agent Reference

**AnythingGraph** is a universal reasoning graph. Give it any structured knowledge — code, documents, plans — and it parses, cross-references, generates claims, detects drift, and self-audits. Code parsing was the proof of concept. The architecture is the product.

**Design principles:**
- Parser → IR → Enrichment → Graph (IR layer exists, TS parser still writes Neo4j directly)
- Hermetic testing: frozen clock, network guard, ephemeral graph, seeded RNG — all tests are deterministic
- Cross-layer synthesis: claims requiring 2+ layers to derive (code risk × plan impact, coverage gaps)
- Self-audit: graph generates verification questions, agents answer, graph updates itself

## ⚠️ Read WORKFLOW.md First

`WORKFLOW.md` is the step-by-step operating procedure for every task.
This file is reference material — schema, tools, commands. Look things up here mid-task.

---

## Connection

- **Bolt:** `bolt://localhost:7687`
- **Browser:** `http://localhost:7474`
- **Auth:** `neo4j` / `codegraph`
- **CLI:** `cypher-shell -u neo4j -p codegraph "YOUR QUERY"`
- **APOC:** installed (416 functions)

---

## Graph Schema

### Node Labels

Code nodes use multi-labels: `CodeNode:TypeScript:Function`, `CodeNode:SourceFile:TypeScript`, etc.

| Label Pattern | What |
|--------------|------|
| `CodeNode:TypeScript:Function` | Named function |
| `CodeNode:TypeScript:Method` | Class method |
| `CodeNode:TypeScript:Class` | Class declaration |
| `CodeNode:TypeScript:Interface` | Interface |
| `CodeNode:TypeScript:Variable` | const/let/var |
| `CodeNode:TypeScript:TypeAlias` | `type X = ...` |
| `CodeNode:SourceFile:TypeScript` | A `.ts` file |
| `CodeNode:TestFile` | Test file (from enrichment, not parser) |
| `CodeNode:Entrypoint` | MCP tool, CLI command, event handler |
| `CodeNode:Field` | State field (from state enrichment) |
| `CodeNode:Task` / `Milestone` / `Decision` | Plan nodes |
| `CodeNode:VerificationRun` | SARIF/done-check finding |
| `CodeNode:GateDecision` / `AdvisoryGateDecision` | Gate records |
| `CodeNode:GovernanceMetricSnapshot` | Governance metrics |
| `Project` | Top-level project |
| `Claim` / `Evidence` / `Hypothesis` | Claims layer |

### Edge Types

**Code structure:**
`CALLS`, `CONTAINS`, `IMPORTS`, `RESOLVES_TO`, `HAS_PARAMETER`, `HAS_MEMBER`, `EXTENDS`, `IMPLEMENTS`, `POSSIBLE_CALL`, `READS_STATE`, `WRITES_STATE`, `OWNED_BY`, `BELONGS_TO_LAYER`, `REGISTERED_BY`, `CO_CHANGES_WITH`

**Plans & evidence:**
`PART_OF`, `DEPENDS_ON`, `BLOCKS`, `HAS_CODE_EVIDENCE`, `TARGETS`

**Verification:**
`TESTED_BY`, `ANALYZED`, `FLAGS`, `ANCHORED_TO`, `SPANS_PROJECT`, `FROM_PROJECT`

**Claims:**
`SUPPORTED_BY`, `CONTRADICTED_BY`, `WITNESSES`

**Governance provenance:**
`MEASURED`, `DERIVED_FROM_RUN`, `DERIVED_FROM_GATE`, `CAPTURED_COMMIT`, `CAPTURED_WORKTREE`, `EMITS_GATE_DECISION`, `GENERATED_ARTIFACT`

### Key Properties

| Property | On | Meaning |
|----------|-----|---------|
| `riskTier` | Function | LOW / MEDIUM / HIGH / CRITICAL |
| `compositeRisk` | Function | 0.0–1.0 weighted score |
| `fanInCount` / `fanOutCount` | Function | Caller/callee counts |
| `effectiveConfidence` | VerificationRun | TC pipeline output |
| `shadowEffectiveConfidence` | VerificationRun | Shadow lane output |
| `gitChangeFrequency` | SourceFile | 0.0–1.0, churn signal |
| `sourceFamily` | VerificationRun | Tool that produced it (ESLint, Semgrep, done-check) |
| `projectId` | most nodes | Project discriminator |
| `derived` | edges | `true` = layer-2 cached edge |

---

## MCP Tools (57)

If MCP server is running (`node dist/mcp/mcp.server.js`):

**Core:** `preEditCheck`, `simulateEdit`, `impactAnalysis`, `searchCodebase`, `naturalLanguageToCypher`, `traverseFromNode`

**Code quality:** `detectDeadCode`, `detectDuplicateCode`, `detect_hotspots`, `state_impact`, `registration_map`

**Enforcement:** `enforceEdit` — RF-2 gate, returns ALLOW/BLOCK/REQUIRE_APPROVAL

**Session:** `listProjects`, `saveSessionBookmark`, `restoreSessionBookmark`, `saveSessionNote`, `recallSessionNotes`, `session_context_summary`

**Swarm (8):** `swarmPostTask`, `swarmClaimTask`, `swarmCompleteTask`, `swarmGetTasks`, `swarmMessage`, `swarmPheromone`, `swarmSense`, `swarmGraphRefresh`

**Plans (6):** `plan_status`, `plan_drift`, `plan_gaps`, `plan_query`, `plan_priority`, `plan_next_tasks`

**Claims (6):** `claim_status`, `evidence_for`, `contradictions`, `hypotheses`, `claim_generate`, `claim_chain_path`

**Verification (4):** `verification_dashboard`, `explainability_paths`, `confidence_debt_dashboard`, `import_sarif`

**Governance (4):** `commit_audit_status`, `governance_metrics_status`, `parser_contract_status`, `recommendation_proof_status`

**Ground truth:** `groundTruth` — three-panel mirror (Graph State / Agent State / Delta)

**Self-audit:** `self_audit` — generate/apply verification questions

**Utility:** `hello`, `testNeo4jConnection`, `cleanupSession`, `swarmCleanup`

**Parsing:** `parseTypescriptProject`, `checkParseStatus`, `startWatchProject`, `stopWatchProject`, `listWatchers`

MCP config (`.mcp.json`):
```json
{
  "mcpServers": {
    "codegraph": {
      "command": "node",
      "args": ["dist/mcp/mcp.server.js"]
    }
  }
}
```

You don't need MCP. `cypher-shell` works. MCP adds convenience.

**Response format:** All MCP tools return JSON:API — `nodes` map (each node stored once, referenced by ID), `depths` array (relationship chains). Source code truncated to 1000 chars (first 500 + last 500). Use `includeCode: false`, `summaryOnly: true`, `snippetLength: N`, or `maxTotalNodes: N` for compact responses.

---

## Commands

### Health (run anytime)
```bash
npm run probe-architecture     # 46 structural probes
npm run self-diagnosis          # 39 health checks with next-step guidance
npm run done-check              # 77-step integrity gate (MUST pass before declaring done)
npm run rebuild-derived         # Nuke + rebuild all derived edges
npm run graph:metrics           # Record GraphMetricsSnapshot node
```

### Verification scan
```bash
npm run verification:scan       # Semgrep + ESLint → VR nodes + ANALYZED edges (~30s)
```
Run this on every done-check or after significant code changes. Without it:
- All functions get `NO_VERIFICATION` flag → LOWs vanish (all promoted to MEDIUM+)
- Confidence scores collapse (evidence=0, freshness=0)
- Risk tier distribution is artificially inflated

### Enrichment
```bash
npm run enrich:test-coverage    # Scan test files → TESTED_BY edges
```

### Enforcement
```bash
codegraph enforce <files> --mode enforced   # Gate: ALLOW/BLOCK/REQUIRE_APPROVAL
# Or: npx tsx src/scripts/entry/enforce-edit.ts <files> --mode enforced
```

### Parse
```bash
codegraph parse .                          # MERGE mode, auto-detect projectId
codegraph parse . --fresh                  # Destructive wipe + reparse
codegraph parse . --project-id <ID>        # Explicit project
```

### Plan ingestion
```bash
npx tsx src/core/parsers/plan-parser.ts /path/to/plans --ingest --enrich
```

### Verification pipeline
```bash
npm run verification:sarif:import -- <projectId> <sarifPath>
npm run verification:scope:resolve -- <projectId>
npm run verification:advisory:gate -- <projectId>
npm run commit:audit:verify -- <baseRef> <headRef>
```

---

## When to Use Graph vs Read Files

| Situation | Use |
|-----------|-----|
| "What calls this function?" | Graph (`CALLS` edges) |
| "What's the blast radius?" | Graph (blast radius query below) |
| "What does this function do?" | Graph (`sourceCode` property — full source text on every node) |
| "I need complex logic detail" | Read the file |
| "What state does this touch?" | Graph (`READS_STATE`/`WRITES_STATE`) |
| "Is this used anywhere?" | Graph (dead code query below) |
| "Who reviews changes here?" | Graph (`OWNED_BY` → Author) |
| "What layer? Am I creating a violation?" | Graph (`architectureLayer`) |
| "What files co-change with this?" | Graph (`CO_CHANGES_WITH`) |

---

## Reference Queries

### Blast radius
```cypher
MATCH (f:Function {name: $name, projectId: $pid})
OPTIONAL MATCH (caller)-[:CALLS]->(f)
OPTIONAL MATCH (f)-[:CALLS]->(callee)
RETURN f.riskTier, collect(DISTINCT caller.name) AS calledBy, collect(DISTINCT callee.name) AS calls
```

### State flow
```cypher
MATCH (f:Function {name: $name})-[e:READS_STATE|WRITES_STATE]->(field:Field)
RETURN type(e) AS access, field.name AS field
```

### Hidden dependencies (temporal coupling)
```cypher
MATCH (a:SourceFile {projectId: $pid})-[r:CO_CHANGES_WITH]->(b)
WHERE NOT (a)-[:IMPORTS]->(b) AND NOT (b)-[:IMPORTS]->(a)
RETURN a.name, b.name, r.coChangeCount ORDER BY r.coChangeCount DESC LIMIT 10
```

### Cross-layer calls
```cypher
MATCH (sf1:SourceFile {projectId: $pid})-[:CONTAINS]->(c1)-[:CALLS]->(c2)<-[:CONTAINS]-(sf2)
WHERE sf1.architectureLayer <> sf2.architectureLayer
RETURN sf1.architectureLayer AS from, sf2.architectureLayer AS to, count(*) AS calls
ORDER BY calls DESC
```

### Guaranteed vs conditional callers
```cypher
MATCH (caller)-[c:CALLS]->(f:Function {name: $name, projectId: $pid})
RETURN caller.name, c.conditional, c.conditionalKind, caller.filePath
ORDER BY c.conditional
```
Unconditional (`conditional=false`) = WILL break. Conditional = MIGHT break.

### Read source code from graph (no file open needed)
```cypher
MATCH (f:Function {name: $name, projectId: $pid}) RETURN f.sourceCode
```

### Dead code (exported, never called)
```cypher
MATCH (f:Function {projectId: $pid})
WHERE f.isExported = true AND NOT ()-[:CALLS]->(f) AND NOT (f)<-[:REGISTERED_BY]-()
RETURN f.name, f.filePath
```

### God functions (>200 lines)
```cypher
MATCH (f:Function {projectId: $pid}) WHERE f.lineCount > 200
RETURN f.name, f.lineCount, f.riskTier, f.filePath ORDER BY f.lineCount DESC
```

### Project overview
```cypher
MATCH (p:Project) RETURN p.name, p.projectId, p.nodeCount, p.edgeCount
```

---

## Risk Tiers

| Tier | compositeRisk | What It Means |
|------|---------------|---------------|
| CRITICAL | top quartile | Core infrastructure. Check ALL callers. Full dependency chain. |
| HIGH | 50-75th pctile | Widely used. Check dependents before editing. |
| MEDIUM | 25-50th pctile | Normal caution. |
| LOW | bottom quartile | Leaf functions, utilities. Safe to edit. |

---

## Multi-Project Awareness

**Always filter by `projectId`.** The graph contains multiple projects:

```cypher
// WRONG — queries across all projects
MATCH (f:Function {name: 'run'}) RETURN f

// RIGHT — scoped
MATCH (f:Function {name: 'run', projectId: 'proj_c0d3e9a1f200'}) RETURN f
```

---

## Architecture

**Six layers:** Code (TypeScript parsing) → Plans (task/milestone tracking) → Governance (verification runs) → Claims (domain-agnostic assertions) → Reasoning (hypotheses from evidence gaps) → Self-Audit

**Parser tiers:** Tier 0 = compiler (ts-morph for TS), Tier 1 = workspace-semantic (Pyright for Python), Tier 2 = structural (tree-sitter fallback)

**IR layer:** `src/core/ir/` — schema + materializer exist. Current TS parser writes Neo4j directly. IR becomes primary path for multi-language.

**Playbooks:**
- **Claim refresh:** `claim_generate` → `claims:cross:synthesize` → `claim_chain_path`
- **Plan refresh:** `plan:refresh` → `edges:normalize` → `plan:evidence:recompute`
- **Embedding tuning:** `plan:embedding:match --threshold=0.75 --limit=3` → `embedding:fp:verify` → target FP < 5%
- **Failure recovery:** `PLAN_FRESHNESS_GUARD_FAILED` → run `plan:refresh`. `invariant_proof_completeness` fail → run `verification:proof:record`. Neo4j auth issues → check `.env`.

---

## Environment

```
NEO4J_URI=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=codegraph
OPENAI_API_KEY=required_for_embeddings  # in codegraph/.env
```

---

## Rules

1. **Follow WORKFLOW.md.** Every task, every time.
2. **Query the graph, don't trust recall.** Your context window lies. The graph doesn't.
3. **Filter by `projectId` in every query.** Never query across projects accidentally.
4. **All new edges must have `{derived: true}`** — layer-2 cached derived edges.
5. **Source change → `npm run build` → restart watcher.** Runtime reads `dist/`, not `src/`.
6. **Don't weaken tests to match bugged code.** If a test fails and the code is wrong, flag it and wait.
7. **`npm run done-check` must exit 0** before any task is declared done.
8. **1,136+ tests.** Full suite in ~21s. No excuses for skipping.
9. **Use `sourceCode` property** to read function implementations from graph before opening files.
10. **Conventional Commits:** `type(scope): description` — feat, fix, docs, test, refactor, chore.
11. **Never report partial enrichment as truth.** Running 2-3 enrichments manually gives incomplete numbers because steps have dependencies (e.g., composite-risk consumes temporal-coupling flags). Run `done-check` for authoritative metrics, or explicitly caveat which steps were skipped.
12. **Multi-agent: wrap graph writes with `flock`.** See "Graph Write Lock" in WORKFLOW.md. All Neo4j-writing commands must use `flock /tmp/codegraph-pipeline.lock <command>` to prevent concurrent mutation.
