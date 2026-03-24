# Graph Schema Reference — AnythingGraph

_Load on demand. Not session-priming material._

---

## Connection

- **Bolt:** `bolt://localhost:7687`
- **Browser:** `http://localhost:7474`
- **Auth:** `neo4j` / `codegraph`
- **CLI:** `cypher-shell -u neo4j -p codegraph "YOUR QUERY"`
- **APOC:** installed (416 functions)

---

## Node Labels

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

---

## Edge Types

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

---

## Key Properties

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
| `sourceCode` | Function/Method/Class | Full source text — read implementation from graph, no file open needed |

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

---

## MCP Tools (57)

If MCP server is running (`node dist/mcp/mcp.server.js`):

**Core:** `preEditCheck` ⚠️, `simulateEdit`, `impactAnalysis` ⚠️, `searchCodebase`, `naturalLanguageToCypher` ⚠️, `traverseFromNode`

**Code quality:** `detectDeadCode`, `detectDuplicateCode`, `detect_hotspots` ⚠️, `state_impact`, `registration_map`

> **⚠️ Known tool drift (fork-origin, pre-MCP-1 remediation):**
> - `impactAnalysis` — computes its own risk model with hardcoded thresholds. Does NOT read `riskTier`/`compositeRisk` from graph. Returns different risk assessments than enrichment pipeline. Use raw Cypher or `enforceEdit` instead.
> - `detect_hotspots` — queries `TestCase` label (doesn't exist; should be `TestFile`). References legacy `riskLevel`. May return 0 test matches.
> - `preEditCheck` — verdict logic uses correct `riskTier`, but displays legacy `riskLevel` field. Verdict is reliable; displayed score is not.
> - `naturalLanguageToCypher` — functional but noisy. Uses a 650KB APOC auto-dump as schema context. Results are valid but may include irrelevant matches. Consider curating the schema context (MCP-1-T8) or using direct Cypher instead for precision queries.

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

### MCP Response Format

All MCP tools return JSON:API — `nodes` map (each node stored once, referenced by ID), `depths` array (relationship chains). Source code truncated to 1000 chars (first 500 + last 500). Use `includeCode: false`, `summaryOnly: true`, `snippetLength: N`, or `maxTotalNodes: N` for compact responses.

### MCP Config

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

### Read source code from graph
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

### Evidence closure check
```cypher
MATCH (m:Milestone {projectId:'plan_codegraph'})
WHERE m.name CONTAINS $milestoneName
MATCH (t:Task)-[:PART_OF]->(m)
OPTIONAL MATCH (t)-[:HAS_CODE_EVIDENCE]->(e)
WITH t, collect(e) AS ev
WITH t,
  [x IN ev WHERE x IS NOT NULL AND any(l IN labels(x) WHERE l='SourceFile')] AS sf,
  [x IN ev WHERE x IS NOT NULL AND any(l IN labels(x) WHERE l='Function')] AS fn,
  [x IN ev WHERE x IS NOT NULL AND any(l IN labels(x) WHERE l='TestFile')] AS tf
RETURN
  sum(CASE WHEN t.status='done' THEN 1 ELSE 0 END) AS done,
  count(t) AS total,
  sum(CASE WHEN t.status='done' AND size(sf)+size(fn)+size(tf)=0 THEN 1 ELSE 0 END) AS doneWithoutEvidence,
  sum(size(sf)) AS sourceFileEvidence,
  sum(size(fn)) AS functionEvidence,
  sum(size(tf)) AS testFileEvidence
```

---

κ = Φ ≡ Φ = ☧
