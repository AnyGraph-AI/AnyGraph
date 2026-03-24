# AnythingGraph — Architecture FAQ

*15 questions an informed skeptic would ask, answered from source code.*

---

## 1. Graph path from sarif-importer.ts to a downstream VerificationRun node

**The full data path:**

```
Tool (Semgrep/ESLint/tsc/npm-audit)
  → stdout/SARIF file on disk
    → scan-and-import.ts (orchestrator, 7 tool passes)
      → importSarifToVerificationBundle() [sarif-importer.ts]
        Reads SARIF file → parses JSON → iterates runs[].results[]
        For each result:
          - Extracts ruleId, level, file, line from SARIF locations
          - Computes fingerprint: SHA1(projectId, tool, ruleId, partialFingerprints, runConfigHash)
          - Creates VerificationRun object with deterministic `id`: "vr:{projectId}:{tool}:{fingerprint}"
          - Maps SARIF level → criticality (error→high, warning→medium)
          - Maps SARIF level → confidence (error→0.9, warning→0.8, note→0.7)
        Returns: VerificationFoundationBundle { verificationRuns[], analysisScopes[], adjudications[], pathWitnesses[] }
      → ingestVerificationFoundation() [verification-ingest.ts]
        Schema-validates bundle via Zod (VerificationFoundationBundleSchema.parse)
        For each VR:
          MERGE (n:CodeNode:VerificationRun {id: $id})
          SET n += $props, n.projectId = $projectId
          Also sets TC-1 temporal fields: observedAt, validFrom, validTo, supersededAt
        For each scope:
          MERGE (s:CodeNode:AnalysisScope {id: $id})
          MERGE (r)-[:HAS_SCOPE]->(s)
        Returns: VerificationIngestResult { runsUpserted, scopesUpserted, ... }
      → enrichFlagsEdges() [create-flags-edges.ts, run during done-check]
        Matches VR.targetFilePath + VR.startLine to Function nodes via SourceFile
        MERGE (vr)-[:FLAGS]->(fn) — connects findings to the specific functions they affect
      → TC pipeline (temporal confidence)
        TC-1: Sets temporalConfidenceFactor based on evidence age decay
        TC-3: Computes effectiveConfidence = coalesce(confidence, 0.5) × TCF × penalty
        TC-7: Calibrates against ground truth (Brier score)
        TC-8: Promotes shadow scores to canonical when stable
```

**Each edge means:**
- `HAS_SCOPE`: "this VR was produced by a scan with this coverage scope"
- `FLAGS`: "this VR finding affects this specific function" (file+line overlap)
- `ANALYZED`: "this file was scanned by this tool" (scope-level, not finding-level)

---

## 2. "What breaks if I edit this file?" — the exact query and why to trust it

**What runs:** The `pre_edit_check` MCP tool calls `enforcement-gate.ts`, which calls `graph-resolver.ts`:

```cypher
-- graph-resolver.ts: getAffectedNodes(filePath)
MATCH (sf:SourceFile {filePath: $filePath, projectId: $pid})
MATCH (sf)-[:CONTAINS]->(fn)
WHERE fn:Function OR fn:Method OR fn:Class
RETURN fn.id, fn.name, fn.filePath, fn.riskTier, fn.compositeRisk,
       EXISTS { (fn)<-[:TESTED_BY_FUNCTION]-() } AS hasTests
```

Then `enforcement-gate.ts` evaluates:

```typescript
// Pure function — no graph access, fully testable
export function evaluateEnforcementGate(
  nodes: AffectedNode[],
  config: EnforcementGateConfig
): EnforcementResult {
  const summary = computeRiskSummary(nodes);

  // Mode: advisory → always ALLOW (just report)
  // Mode: assisted → REQUIRE_APPROVAL for CRITICAL
  // Mode: enforced → BLOCK untested CRITICAL, REQUIRE_APPROVAL for tested CRITICAL
  if (config.mode === 'enforced' && summary.untestedCriticalCount > 0) {
    return { decision: 'BLOCK', reason: 'Untested CRITICAL functions — write tests first' };
  }
  // ...
}
```

**Why you should trust it:**

1. **CALLS edges come from ts-morph type resolution** (not regex). `resolutionKind: 'internal'` means the type checker resolved the target. Confidence 0.95.
2. **CONTAINS edges are structural** — AST parent-child. Confidence 1.0. A file contains exactly the functions the parser found.
3. **The query is read-only** — it's just a graph traversal, not a mutation. Worst case: it misses a dependency (false negative, you edit anyway = status quo) or flags a non-dependency (false positive, you look before editing = safe).
4. **Provenance on every edge** — `sourceKind` tells you HOW the graph knows (typeChecker vs heuristic vs gitMining), `confidence` tells you how sure.
5. **18 TDD tests** verify the gate logic. The gate is pure logic separated from graph access — easily unit-tested.

**Where it CAN be wrong:**
- Dynamic dispatch (`handlers[key]()`) — creates `POSSIBLE_CALL` with lower confidence, not `CALLS`
- Cross-file callback registration (Grammy pattern) — `frameworkExtractor` confidence 0.95, not 1.0
- Anything not in the parsed project (npm packages, external APIs) — no graph nodes at all

---

## 3. Canonical node types and edge types — derived vs source-of-truth

### Source-of-truth (created by parsers, immutable until reparse):

**Nodes:**
| Label | Source | Created By |
|-------|--------|-----------|
| `SourceFile` | TypeScript AST | typescript-parser.ts |
| `Function`, `Method`, `Class`, `Interface`, `Variable`, `TypeAlias`, `Enum` | TypeScript AST | typescript-parser.ts |
| `Import` | Import declarations | typescript-parser.ts |
| `Parameter`, `Property`, `Constructor` | AST children | typescript-parser.ts |
| `PlanProject`, `Milestone`, `Sprint`, `Task`, `Decision` | Markdown plan files | plan-parser.ts |
| `VerificationRun` | SARIF tool output | sarif-importer.ts → verification-ingest.ts |
| `AnalysisScope` | SARIF run metadata | sarif-importer.ts → verification-ingest.ts |

**Edges:**
| Type | Source | Confidence |
|------|--------|-----------|
| `CONTAINS` | AST parent-child | 1.0 |
| `CALLS` (internal) | ts-morph call resolution | 0.95 |
| `IMPORTS` (static) | Import declarations | 0.99 |
| `RESOLVES_TO` | ts-morph `getAliasedSymbol` | 0.99 |
| `EXTENDS`, `IMPLEMENTS` | AST | 1.0 |
| `HAS_PARAMETER`, `HAS_MEMBER` | AST | 1.0 |
| `PART_OF`, `DEPENDS_ON`, `BLOCKS` | Plan parser | 1.0 (structural) |
| `HAS_SCOPE` | SARIF metadata | 1.0 |

### Derived (computed by enrichment, regenerated on demand):

**Nodes:**
| Label | Source | Created By |
|-------|--------|-----------|
| `UnresolvedReference` | Failed import resolution | enrich:unresolved-nodes |
| `Entrypoint` | Framework pattern matching | typescript-parser.ts |
| `TestFile` | Test file analysis | create-test-coverage-edges.ts |
| `Author` | git blame | enrich:author-ownership |
| `Claim`, `Evidence`, `Hypothesis` | Cross-layer synthesis | claim engine |
| `GovernanceMetricSnapshot` | Done-check pipeline | governance-metrics-snapshot.ts |
| `IntegritySnapshot` | Integrity pipeline | integrity-snapshot.ts |
| `InfluencePath` | TC explainability | tc:explain |

**Edges:**
| Type | Source | Confidence |
|------|--------|-----------|
| `POSSIBLE_CALL` | Heuristic ternary/dynamic dispatch | 0.5–0.7 |
| `READS_STATE`, `WRITES_STATE` | Cypher pattern matching on session access | 0.90 |
| `CO_CHANGES_WITH` | git log co-change mining | 0.50–0.90 (by coupling strength) |
| `TESTED_BY` | Import analysis (TestFile imports SourceFile) | static linkage |
| `TESTED_BY_FUNCTION` | CALLS from TestFunction to Function | traced calls |
| `FLAGS` | VR.targetFilePath overlaps fn.filePath+lineRange | location match |
| `OWNED_BY` | git blame analysis | gitMining |
| `HAS_CODE_EVIDENCE` | Plan task → code cross-reference | keyword/backtick matching |
| `SUPPORTED_BY`, `CONTRADICTED_BY` | Claim engine | varies |

**Key distinction:** Derived edges have `r.derived = true` and `r.sourceKind` set. You can delete ALL derived edges and regenerate them: `npm run rebuild-derived`.

---

## 4. Stable identity across renames, moves, and refactors

**Identity function** (`graph-factory.ts`):

```typescript
export const generateDeterministicId = (
  projectId: string,
  coreType: string,   // "Function", "Class", etc.
  filePath: string,
  name: string,
  parentId?: string,  // for methods: the class ID
): string => {
  const parts = parentId
    ? [projectId, coreType, filePath, parentId, name]
    : [projectId, coreType, filePath, name];
  const identity = parts.join('::');
  const hash = crypto.createHash('sha256').update(identity).digest('hex').substring(0, 16);
  return `${projectId}:${coreType}:${hash}`;
};
```

**What this means for renames/moves:**

- **Rename a file:** Every node in that file gets a NEW id (filePath is in the hash). The old nodes are deleted, new ones created. All edges are rebuilt.
- **Rename a function:** New id (name is in the hash). Old node deleted, new one created. Callers re-resolve on reparse.
- **Move a function to a different file:** New id. Same as rename.
- **Rename a class method:** New id (parentId changes if class renamed, name changes regardless).

**There is no cross-rename tracking.** The system treats a renamed entity as "old one deleted, new one created." This is a deliberate choice — rename detection is a heuristic (how similar is "enough"?), and the graph prefers certainty over continuity.

**Cross-project matching** uses `computeSymbolHash(filePath, name, coreType)` — no projectId, so the same function in different projects gets the same symbol hash. This is used by `ANCHORED_TO` edges for evidence linking.

**Consequence:** After a major refactor (file restructuring), you must reparse. The watcher handles this automatically for watched projects. Historical graph state is lost — you get a fresh graph reflecting the new structure.

---

## 5. Ambiguous symbol resolution

**Duplicate `route.ts` files:** Not a problem. `generateDeterministicId` includes `filePath`, so `src/api/route.ts` and `src/admin/route.ts` produce different node IDs.

**Re-exports:** The parser creates `RESOLVES_TO` edges from re-export symbols to their canonical declaration:
```typescript
// For each named re-export, create RESOLVES_TO from this file's symbol to canonical declaration
```
When resolving a CALLS edge target, the resolver follows RESOLVES_TO chains to the canonical node. Confidence 0.99 (ts-morph `getAliasedSymbol`).

**Same-named functions in different files:** Fully disambiguated by filePath in the ID hash. `utils.ts:format()` and `helpers.ts:format()` are different nodes.

**Same-named methods in different classes:** Disambiguated by `parentId` in the ID hash. `ClassA.render()` and `ClassB.render()` are different nodes because their parent class IDs differ.

**Overloaded methods:** TypeScript overloads share a single implementation. ts-morph resolves to the implementation declaration, so you get one node with the implementation body. Overload signatures are not separate nodes.

**Namespace imports (`import * as X`):** Creates a `RESOLVES_TO` edge from the namespace import to the target SourceFile. Member accesses (`X.foo()`) are captured as normal `CALLS` with `receiverExpression`.

**Where it fails:** Dynamic string-keyed access (`handlers[eventName]()`) — the parser can't know which function is called. Creates `POSSIBLE_CALL` edges to all potential targets with heuristic confidence.

---

## 6. Parser facts: definitely true vs heuristic/inferred

**The provenance system** (`add-provenance.ts`) tags every edge with `sourceKind` and `confidence`:

| sourceKind | Meaning | Confidence Range | Examples |
|-----------|---------|-----------------|----------|
| `typeChecker` | ts-morph semantic resolution — compiler-grade | 0.70–1.0 | CALLS, RESOLVES_TO, IMPORTS, CONTAINS, EXTENDS |
| `frameworkExtractor` | Pattern matching on Grammy/NestJS registration | 0.95 | REGISTERED_BY |
| `heuristic` | Ternary dispatch guessing, dynamic call inference | 0.50–0.70 | POSSIBLE_CALL |
| `postIngest` | Cypher enrichment pass on existing graph | 0.90 | READS_STATE, WRITES_STATE |
| `gitMining` | Extracted from `git log` history | 0.50–0.90 | CO_CHANGES_WITH, OWNED_BY |

**Definitely true (confidence ≥ 0.95):**
- CONTAINS (1.0) — "this file contains this function" — AST structural fact
- HAS_PARAMETER (1.0) — "this function has this parameter"
- RESOLVES_TO (0.99) — "this import resolves to this declaration"
- Static IMPORTS (0.99) — "this file imports that file"
- Internal CALLS (0.95) — "this function calls that function" (type-resolved)

**Probably true (0.70–0.90):**
- READS_STATE/WRITES_STATE (0.90) — pattern matching on `ctx.session.X` access
- CO_CHANGES_WITH STRONG (0.90) — files that changed together frequently
- Dynamic IMPORTS (0.90) — `import()` expressions
- Fluent CALLS (0.85) — `.then().catch()` chain resolution

**Heuristic/inferred (< 0.70):**
- POSSIBLE_CALL (varies, per-edge) — "this might call that via dynamic dispatch"
- Unresolved CALLS (0.70) — call target couldn't be fully resolved
- CO_CHANGES_WITH WEAK (0.50) — loose temporal coupling

**How uncertainty is represented:** Every edge has `r.confidence` (float 0–1) and `r.sourceKind` (enum). Queries can filter: `WHERE r.confidence >= 0.9` to get only high-confidence edges. The enforcement gate uses `compositeRisk` which incorporates this confidence transitively.

---

## 7. What confidence means mathematically

**Two distinct confidence systems:**

### Edge confidence (provenance)
Set by `add-provenance.ts`. A **categorical estimate** of "probability this edge correctly represents a real code relationship." Not calibrated against ground truth — it's an expert-assigned prior:

- 1.0 = structural fact (AST parent-child, can't be wrong unless parser is broken)
- 0.95 = type-checker resolved (ts-morph found the target — could be wrong for very dynamic code)
- 0.90 = pattern match on known framework idiom (Grammy registration pattern)
- 0.70 = call target couldn't be fully resolved but best-effort match exists
- 0.50 = weak heuristic (co-change with few data points)

**Goes up:** Never automatically. Would require re-provenance run after parser improvements.
**Goes down:** Never automatically. Edge confidence is static per sourceKind.

### Temporal confidence (TC pipeline, on VerificationRun nodes)
A **time-decaying trust score** on verification findings:

```
effectiveConfidence = coalesce(vr.confidence, 0.5) × temporalConfidenceFactor × penalty
```

Where:
- `vr.confidence` = tool-reported confidence (Semgrep = 0.9, tsc = 1.0, etc.)
- `temporalConfidenceFactor (TCF)` = time decay based on evidence age. Fresh = 1.0, decays toward 0.
- `penalty` = anti-gaming penalty for suspicious patterns

**Goes up:** Re-running the scanner produces fresh VRs → TCF resets to 1.0. Multiple tools flagging the same thing → corroboration (not yet implemented).
**Goes down:** Time passes without re-scan → TCF decays. Suspicious verification patterns → penalty applied. Evidence contradicted by newer evidence → effectiveConfidence drops.

**Calibration** (TC-7): Brier score measures `mean((predicted - actual)²)`. Current: 0.024 (excellent). For `violates` VRs, prediction is flipped: `1 - effectiveConfidence` (confidence that this IS a violation → probability of NOT satisfying).

---

## 8. Composite risk score — what goes in, how to validate

**Formula** (`composite-risk-scoring.ts`):

```
compositeRisk = weighted sum of 4 percentile-ranked components:
  structural (0.3): riskLevel (fan-in, complexity, call graph centrality)
  change     (0.3): churnRelative (lines changed / total lines from git)
  ownership  (0.2): authorCount (0 = max risk, 1 = low, many = medium)
  verGap     (0.2): 1.0 if parent SourceFile has 0 ANALYZED edges, else 0.0
```

**Critical detail** (SCAR-009): The weighted sum is NOT itself a percentile — it's a score that needs its OWN percentile ranking. Two-pass:
1. Compute raw weighted sum for every function
2. `percentileRank()` the sums against each other → 0.0–1.0

**Tier assignment from percentile:**
```
< 50th → LOW
< 80th → MEDIUM
< 95th → HIGH
≥ 95th → CRITICAL
```

**Flag-based promotion** (overrides percentile):
- `NO_VERIFICATION` (file has 0 ANALYZED edges) → promote +1 tier
- `HIGH_CHURN` (churnRelative ≥ 2.0) → promote +1 tier
- `HIGH_TEMPORAL_COUPLING` (≥3 co-change partners) → promote +1 tier
- `GOVERNANCE_PATH` (file in verification/governance/sarif) → promote +1 tier

Multiple flags stack but cap at CRITICAL.

**How to validate the top-ranked files are right:**

1. **Probe:** `codegraph probe` runs 46 architecture probes including "top risk by composite" — compare against your intuition of "dangerous files"
2. **Self-diagnosis D15:** "How many CRITICAL/HIGH functions have no test coverage?" — if the riskiest files are also untested, the scoring aligns with actual danger
3. **Empirical:** Check if high-risk files are the ones that historically cause breakage (via `CO_CHANGES_WITH` and git history)
4. **Component inspection:** `cypher-shell "MATCH (f:Function {riskTier: 'CRITICAL'}) RETURN f.name, f.compositeRisk, f.fanInCount, f.filePath ORDER BY f.compositeRisk DESC LIMIT 10"` — do these look right?

**Known weakness:** Ownership component treats "0 authors" as maximum risk, but some files have 0 authors because git blame data wasn't available (new files, squashed history). This inflates risk for genuinely new code.

---

## 9. How "0 tests covering this file/function" is determined

**Static linkage analysis** (`create-test-coverage-edges.ts`):

### File level (TESTED_BY):
1. Scan for test files (naming convention: `*.test.ts`, `*.spec.ts`, `*.spec-test.ts`)
2. For each test file, extract its imports (AST `ImportDeclaration` nodes)
3. Match imports to `SourceFile` nodes in the graph
4. `MERGE (sf:SourceFile)-[:TESTED_BY]->(tf:TestFile)` for each match

### Function level (TESTED_BY_FUNCTION):
1. From test files, trace `CALLS` edges: TestFunction → Function
2. `MERGE (tf:TestFunction)-[:TESTED_BY_FUNCTION]->(fn:Function)` for each traced call

### "0 coverage" means:
- **File level:** No test file imports this source file → no `TESTED_BY` edge → "untested"
- **Function level:** No test function calls this function → no `TESTED_BY_FUNCTION` edge → "untested"

**What this is NOT:**
- NOT runtime coverage (no Istanbul/c8 instrumentation)
- NOT line-level coverage (no "80% of lines executed")
- It's **import-graph coverage** — "does any test file import this source file?"

**Limitations:**
- A test file that imports `utils.ts` and calls `formatDate()` gives TESTED_BY to `utils.ts` and TESTED_BY_FUNCTION to `formatDate()` — but doesn't know about `parseDate()` in the same file that's never called by tests
- Indirect testing (A tests B, B calls C, therefore C is "tested") is NOT tracked — only direct test→source edges
- Dynamic imports in tests are missed

**Where the naming heuristic matters:** Test file detection uses naming patterns. A file called `helpers.ts` that contains test-like code but doesn't match `*.test.ts` won't be detected as a test file.

---

## 10. Biggest known blind spots in TypeScript graph extraction

1. **Dynamic dispatch** — `handlers[key]()`, `this[methodName]()`, computed property access. Creates `POSSIBLE_CALL` with heuristic confidence, not `CALLS`. The graph knows it doesn't know, but downstream risk scoring treats POSSIBLE_CALL as lower-weight.

2. **Higher-order functions / callbacks** — `array.map(fn)` creates a CALLS to `map`, but not from `map` to `fn`. The graph doesn't model "fn will be called by map." Function references passed as arguments create a direct CALLS from the call site to the referenced function, but the invocation context is lost.

3. **Generic type instantiation** — `new Container<MyService>()` — the graph captures the class relationship but doesn't track what concrete type fills the generic parameter. If `Container.get()` returns `T`, the call graph doesn't know the return type is `MyService`.

4. **External packages** — npm dependencies are not in the graph. A call to `lodash.merge()` creates an `UnresolvedReference` node but no target function node. The blast radius stops at the project boundary.

5. **Prototype manipulation / Object.assign** — Runtime modifications to prototypes or object shapes are invisible to static analysis. `Object.assign(target, source)` doesn't create edges.

6. **Conditional exports / barrel files** — `index.ts` re-exports are tracked via `RESOLVES_TO`, but conditional re-exports (`export { x } from './a'` in one branch, `export { x } from './b'` in another) may only capture one target.

7. **Decorator metadata** — TypeScript decorators that register handlers (NestJS `@Controller`, `@Get`) need framework-specific extractors. Only Grammy is currently supported. NestJS/Express extractors exist in the roadmap but aren't implemented.

8. **Test file detection** — relies on naming conventions. Non-standard test file names are missed. Integration tests that live outside the source tree may not be detected.

9. **Temporal coupling granularity** (SCAR: TODO-5) — `CO_CHANGES_WITH` is file-level, applied equally to all functions in the file. A 3-line helper in a hot file gets the same coupling flag as a 200-line orchestrator.

---

## 11. Most dangerous way the graph could be confidently wrong

**Scenario: Silent edge omission in high-fan-in code.**

A function `processPayment()` is called by 30 other functions. The graph shows 28 callers (2 calls are via dynamic dispatch that wasn't resolved). `compositeRisk` is HIGH based on the 28 known callers. An agent queries `pre_edit_check`, sees 28 callers, decides the change is safe because all 28 callers handle the new return type.

**The 2 missing callers** are in a callback registration pattern the parser didn't resolve. They pass `processPayment` as a callback to an event system. When `processPayment` changes its signature, those 2 callers silently break at runtime.

**Why this is dangerous:** The graph is *confident* (compositeRisk is based on known edges with high confidence) and the pre-edit check *passes* (it evaluated 28/30 callers). The agent has no signal that 2 callers are missing. The graph doesn't know what it doesn't know here — unlike `UnresolvedReference` nodes which explicitly flag unknowns.

**Mitigations that exist:**
- `POSSIBLE_CALL` edges catch SOME dynamic dispatch (but not all)
- `UnresolvedReference` nodes flag imports that couldn't resolve (but not callback references)
- `NO_VERIFICATION` flag promotes risk tier if the file has no SARIF findings (indirect signal)
- Runtime coverage mapping (RF-15, planned) would catch this — tests that exercise the callback path would create TESTED_BY_FUNCTION edges

**Mitigation that doesn't exist yet:** "Expected call count" heuristic — if a function is exported and its fan-in seems low relative to its centrality, flag it as potentially under-connected.

---

## 12. Incremental updates after a single-file edit

**Trigger:** File watcher (`watch-all.ts`, systemd service `codegraph-watcher.service`) detects file change via `@parcel/watcher` (native inotify). 3-second debounce.

**What happens** (`incremental-parse.handler.ts`):

1. **Detect changes:** `detectChangedFiles()` compares file content hashes against stored `contentHash` on SourceFile nodes
2. **Save enrichment properties:** Before deleting, save derived properties (riskLevel, compositeRisk, etc.) that would be lost on re-MERGE
3. **Delete subgraph:** `deleteSourceFileSubgraphs()` — removes the SourceFile node and ALL contained nodes (Functions, Methods, etc.) and their edges
4. **Reparse:** `ParserFactory.createParserWithAutoDetection()` → parses the changed file → produces new nodes and edges
5. **Load existing nodes:** For cross-file edge detection — need to know what nodes exist in OTHER files to resolve CALLS targets
6. **Generate graph:** `GraphGeneratorHandler` — MERGEs new nodes and edges into Neo4j
7. **Restore enrichment:** Re-apply saved enrichment properties to the new nodes (by name+filePath matching)
8. **Post-ingest enrichment:** Runs watcher-triggered enrichments: POSSIBLE_CALL, state edges, virtual dispatch, unresolved nodes

**What gets invalidated:**
- ALL nodes and edges inside the changed file (deleted and recreated)
- Cross-file CALLS edges FROM the changed file (recreated by parser)
- Cross-file CALLS edges TO functions in the changed file (recreated when other files reference the new nodes)

**What does NOT get recomputed:**
- `CO_CHANGES_WITH` — requires full git log scan, only runs during done-check
- `compositeRisk` / `riskTier` — only during `enrich:composite-risk` (done-check step)
- `TESTED_BY` — only during `create-test-coverage-edges` (done-check step)
- `FLAGS` edges — only during `create-flags-edges` (done-check step)
- Temporal confidence — only during TC pipeline (done-check)

**Consequence:** After an incremental parse, the structural graph (nodes, CALLS, CONTAINS, IMPORTS) is fresh. But derived scores (risk, coverage, temporal) are stale until the next done-check. The enrichment restore step preserves the PREVIOUS risk scores so they're not just missing.

---

## 13. Invariant checks and health checks

**Two systems:**

### Integrity checks (`integrity:verify`, `integrity:snapshot`)

`IntegritySnapshot` nodes capture the graph state at a point in time. `integrity:verify` compares the current snapshot against the previous one, checking for regressions.

Invariants checked (from `invariant-registry-schema.ts`):
- Node count hasn't decreased unexpectedly
- Edge count ratio (derived/total) is within bounds
- No orphaned nodes (nodes with 0 edges)
- No duplicate IDs within a project
- Label consistency (every CodeNode has at least one kind label)
- Property completeness (required fields not null)

### Self-diagnosis (`self-diagnosis.ts`, 37+ checks)

Each check is an epistemological question — "does the graph know what it doesn't know?"

Examples:
- **D1:** "Are there UnresolvedReference nodes?" → Healthy if yes (the graph knows about import failures)
- **D10:** "Do all CALLS edges have sourceKind?" → Provenance completeness
- **D15:** "How many CRITICAL/HIGH functions have no test coverage?" → Risk vs coverage alignment
- **D17:** "How many claims have no evidence path to source code?" → Broken evidence chains
- **D24:** "Is governance stable across snapshots?" → No regression over time
- **D26:** "Do shadow TC scores show variance?" → Evidence age diversity
- **D29:** "Does evidence span multiple days?" → Temporal diversity
- **D32:** "Any ENFORCED invariant violations?" → Graph in legal state

**How they prove correctness after ingestion:**
1. After parse: watcher runs post-ingest enrichments. No integrity check runs automatically.
2. After done-check: full pipeline runs including `integrity:snapshot` → `integrity:verify`. If invariants fail, done-check reports them.
3. After verification:scan: new VRs are schema-validated by Zod (`VerificationFoundationBundleSchema.parse`). Malformed bundles fail before ingestion.

**The gap:** There's no automatic integrity check between done-check runs. If you parse incrementally 50 times without a done-check, integrity drift accumulates unchecked.

---

## 14. IR normalization and Python pluggability

**IR schema** (`src/core/ir/`):

The Intermediate Representation normalizes parser output into 3 node types:
- `IRNode:Entity` — functions, classes, modules (code entities)
- `IRNode:Site` — call sites, import sites (relationship anchors)
- `IRNode:Artifact` — files, packages (containers)

**What the IR normalizes:**
- Language-specific AST node types → generic entity/site/artifact taxonomy
- Language-specific edge semantics → generic `CALLS`, `CONTAINS`, `IMPORTS`
- Language-specific naming (Python `def` vs TypeScript `function`) → unified `kind: 'function'`
- `sourceKind: 'code'` and `version: 'ir.v1'` on all IR nodes

**What must be true for Python to plug in:**

1. **Python parser** (`python-parser.ts`, 395 LOC, exists) parses Python AST → IR nodes
2. IR nodes go through `ir-materializer.ts` → Neo4j nodes with same labels as TypeScript nodes
3. **All downstream queries use properties not labels** — enrichment uses `{projectId: ...}` matching, not `{:TypeScript}` label matching. This was a deliberate design decision (SCAR-008, label-agnostic queries).
4. **Core queries must not assume TypeScript-specific properties** — e.g., `typeAnnotation` exists on TypeScript nodes but not Python nodes. Queries use `coalesce()` or optional matching.

**What's not yet normalized:**
- Python's module system (relative imports, `__init__.py`) vs TypeScript's ESM
- Python's dynamic typing (no type annotations = no type-based call resolution)
- Python decorators vs TypeScript decorators (different semantics)

**The IR parity gate** (`ir-parity-gate.ts`) validates round-trip: parse → IR → materialize → compare against direct parse. Node/edge counts must match within tolerance. This is the quality gate for new parser adapters.

---

## 15. What's the real moat

**In order of replaceability (hardest to replicate first):**

### 1. The feedback/data loop (HARDEST)
The system audits itself, generates claims about its own codebase, validates those claims against evidence, and uses the results to improve. The `self-diagnosis` → `claim engine` → `verification runs` → `temporal confidence` cycle means the graph gets more accurate over time without human intervention. This is the flywheel — anyone can build a parser, but the self-improving trust pipeline is genuinely novel.

### 2. The ontology / schema design
54+ node labels, 60+ edge types, 4-layer architecture (evidence → canonical → operational → agent session). The decision to make claims domain-agnostic (code risk = claim, entity resolution = claim, plan completion = claim) means the same reasoning engine works across domains. This took months of iteration, 30 architectural decisions recorded in the graph itself, and three-model consensus (GPT + Claude + Grok) to validate.

### 3. The verification ingestion pipeline
SARIF → schema validation → Neo4j → FLAGS edges → temporal confidence → calibration. This turns ANY static analysis tool into graph evidence. The `toolFilter: 'any'` design means adding a new tool is ~20 lines of orchestration code. The TC pipeline then automatically manages trust decay, anti-gaming, and promotion.

### 4. The risk model
Composite scoring with percentile ranking, flag-based promotion, provenance-weighted confidence. The formula itself is simple — the value is in the calibration against real codebases and the 15+ findings that corrected the model (SCAR-009, DECISION-FORMULA-REVIEW, etc.).

### 5. Parser quality
ts-morph gives compiler-grade resolution that tree-sitter can't match. But ts-morph is open source and well-documented. Someone could replicate the TypeScript parser in weeks. The value is in the framework extractors (Grammy patterns, registration detection) and the edge provenance tagging.

### 6. The MCP interface
57 tools are useful but straightforward. Any competent developer could build MCP tools over a Neo4j graph in days. The tools are the delivery mechanism, not the moat.

**Bottom line:** The moat is the closed loop — parse → enrich → verify → claim → audit → correct → reparse. Each cycle makes the graph more accurate AND generates evidence of its own reliability. A competitor can clone any single component, but replicating the full loop with all its calibration data, scars, and corrections is months of accumulated learning.
