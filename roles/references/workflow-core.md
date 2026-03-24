# Workflow Reference — Graph-First Task Execution

_Load on demand. The step-by-step operating procedure for every task._
_Septenary structure: 7 steps (sub-steps nest within). No expansion._

---

## Step 1: Orient and Select (Session Boot + Task Selection)

### 1a. Orient — query graph state

Run these 4 queries first:

```cypher
-- 1. What projects exist?
MATCH (p:Project) RETURN p.name, p.projectId, p.nodeCount, p.edgeCount

-- 2. What's in this project?
MATCH (n {projectId: $pid}) RETURN labels(n)[0] AS type, count(n) AS cnt ORDER BY cnt DESC

-- 3. Where are the landmines?
MATCH (f:Function {projectId: $pid})
WHERE f.riskTier IN ['CRITICAL', 'HIGH']
RETURN f.name, f.riskTier, f.compositeRisk, f.fanInCount, f.filePath
ORDER BY f.compositeRisk DESC LIMIT 20

-- 4. What's the plan status?
MATCH (t:Task)-[:PART_OF]->(m:Milestone)
WHERE m.projectId STARTS WITH 'plan_codegraph'
WITH m, count(t) AS total, sum(CASE WHEN t.status='done' THEN 1 ELSE 0 END) AS done
RETURN m.name, done, total, round(toFloat(done)/total*100) + '%' AS pct
ORDER BY pct
```

### 1b. Select — find the next unblocked task

```cypher
MATCH (t:Task {status: 'planned'})-[:PART_OF]->(m:Milestone)
WHERE m.projectId STARTS WITH 'plan_codegraph'
  AND NOT m.name CONTAINS 'Deferred'
  AND NOT m.name CONTAINS 'DF'
  AND NOT m.name CONTAINS 'N0'
OPTIONAL MATCH (t)-[:DEPENDS_ON]->(dep:Task)
WITH t, m, collect(dep) AS deps
WITH t, m, [d IN deps WHERE d.status <> 'done'] AS blockers
WHERE size(blockers) = 0
RETURN t.name AS task, m.name AS milestone
ORDER BY m.name
```

**The graph cannot tell you WHICH FILES the task will touch.** Planned tasks have zero HAS_CODE_EVIDENCE edges. You must determine relevant source files from the task description, codebase search, or being told.

---

## Step 2: Discover Risk (Affected Files + Risk Query)

### 2a. Identify affected files

```bash
grep -rl "relevant_keyword" src/ --include="*.ts" | grep -v node_modules | grep -v __tests__ | grep -v ".test." | sort
```

Or MCP: `searchCodebase` with natural language. List every file you expect to read or modify.

### 2b. Query file risk and test coverage

For every file from 2a:

```cypher
MATCH (sf:SourceFile {projectId: $projectId})
WHERE sf.name = $filename
OPTIONAL MATCH (sf)-[:CONTAINS]->(fn)
WHERE fn:Function OR fn:Method
OPTIONAL MATCH (sf)-[:TESTED_BY]->(tf)
WITH sf,
  collect(DISTINCT fn.name) AS allFns,
  collect(DISTINCT CASE WHEN fn.riskTier = 'CRITICAL' THEN fn.name END) AS criticals,
  collect(DISTINCT CASE WHEN fn.riskTier = 'HIGH' THEN fn.name END) AS highs,
  count(DISTINCT tf) > 0 AS tested
RETURN sf.name AS file, tested, size(allFns) AS fnCount,
  [x IN criticals WHERE x IS NOT NULL] AS criticalFns,
  [x IN highs WHERE x IS NOT NULL] AS highFns
```

**If a file returns zero results**, the graph is stale. Reparse:

```bash
cd codegraph && npx tsx src/cli/cli.ts parse . --project-id proj_c0d3e9a1f200
npm run rebuild-derived
npm run enrich:test-coverage
```

---

## Step 3: Gate (Enforcement + Prerequisite Tests)

### 3a. Run the enforcement gate

```bash
cd codegraph && npx tsx src/scripts/entry/enforce-edit.ts \
  /absolute/path/to/file1.ts \
  /absolute/path/to/file2.ts \
  --mode enforced
```

| Gate Result | What You Do |
|-------------|-------------|
| ✅ ALLOW (exit 0) | Proceed to Step 4 |
| ⚠️ REQUIRE_APPROVAL (exit 2) | Proceed with awareness |
| 🚫 BLOCK (exit 1) | **STOP. Go to 3b.** |

### 3b. Write prerequisite tests (if gate blocks)

Coverage tests for EXISTING code you're about to modify (not TDD for new features):

```cypher
MATCH (sf:SourceFile {projectId: $projectId})-[:CONTAINS]->(f:Function)
WHERE sf.filePath IN $filePaths AND f.riskTier = 'CRITICAL'
AND NOT EXISTS { MATCH (sf)-[:TESTED_BY]->() }
RETURN sf.name AS file, collect(f.name) AS untestedCriticals
```

Write tests → run `npm test` → commit → re-run `npm run enrich:test-coverage` → re-run gate.

---

## Step 4: Test (TDD Spec Tests)

Write tests for NEW functionality from the task spec. Tests should FAIL before implementation.

### Spec-test naming convention
- `rf10-entropy-monitoring.spec-test.ts` for RF-10
- Located in `src/core/test-harness/__tests__/semantic/`

### Find existing patterns
```cypher
MATCH (sf:SourceFile {projectId: $projectId})-[:TESTED_BY]->(tf:TestFile)
RETURN sf.name AS sourceFile, collect(tf.name) AS testFiles
ORDER BY sf.name
```

Recent spec-tests may not be in graph — check disk:
```bash
find src -name "*.spec-test.ts" | sort
```

### Structure
```typescript
/**
 * RF-10: Entropy Monitoring — Spec Tests
 * Tests written FROM the spec.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

describe('RF-10: Entropy Monitoring', () => {
  // Tests that FAIL before implementation
});
```

---

## Step 5: Implement (Write Code + Annotate Artifacts)

### 5a. Write the implementation

Make the TDD spec tests pass. Run `npm test` — all tests (existing + new) must pass.

#### Route cold-start UX invariant (new pages/routes)
Ship all three: (1) cold-start empty state, (2) default seed fallback or CTA, (3) test coverage for no-param behavior.

#### When a pre-existing test breaks (NON-NEGOTIABLE)

| Situation | Verdict | Action |
|-----------|---------|--------|
| Intentionally altered tested behavior | Spec changed | Update test, document in commit |
| Test asserted implementation details | Brittle test | Rewrite to assert contract |
| Don't understand why it broke | Investigate | Do NOT proceed |
| Test catches real regression | Code is wrong | Fix code, not test |

**Never:** skip, delete, weaken, dismiss as "earlier implementation," or proceed with failing tests.

**Pre-existing failures:** Document them before starting. A green baseline is a precondition.

### 5b. Annotate task with artifacts

Update task text in plan file with backtick references to every file, function, and test produced.

```bash
git diff --name-only HEAD~1
```

Append: source files (`` `file.tsx` ``), functions (`` `ComponentName` ``), tests (`` `test-file.test.ts` ``).

---

## Step 6: Verify (Post-Implementation Checks)

### 6a. New untested CRITICAL functions?
```cypher
MATCH (sf:SourceFile {projectId: $projectId})-[:CONTAINS]->(f:Function)
WHERE sf.filePath IN $changedFiles AND f.riskTier = 'CRITICAL'
AND NOT EXISTS { MATCH (sf)-[:TESTED_BY]->() }
RETURN f.name AS untestedCritical, sf.name AS file
```

### 6b. Gate on changed files
```bash
npx tsx src/scripts/entry/enforce-edit.ts $CHANGED_FILES --mode enforced
```

### 6c. Full test regression
```bash
npm test
```

### 6d. Self-diagnosis
```bash
npm run self-diagnosis
```

### 6e. Done-check
```bash
npm run done-check
```

77 steps. Must exit 0. If delegated: record `done-check delegated / pending external result`.

### 6f. Evidence closure check (mandatory)
Run the closure query from `references/schema.md`. Requirements: `doneWithoutEvidence=0`, all three evidence families present where applicable.

### 6g. Long-run pipeline handling
For heavy commands: provide progress updates every ~2-3 minutes. If runtime exceeds expectation, offer: continue / stop / delegate.

---

## Step 7: Seal (Commit + Post-Commit Enrichment)

```bash
git add <files>
git commit -m "RF-10: description of what was done"
```

Pre-commit hook runs gate automatically. Don't use `--no-verify` without documented reason.

After commit:
- `npm run enrich:test-coverage` (update TESTED_BY edges)
- `npm run verification:scan` (update VR nodes — without this, LOWs vanish)
- Verify graph sees your changes

---

## Conventions

### Conventional Commits
`type(scope): description` — types: `feat`, `fix`, `docs`, `test`, `refactor`, `chore`.

### Test Suite
1,136+ tests. Full suite ~21 seconds. No excuses for skipping.

---

## Commands Quick Reference

### Health
```bash
npm run probe-architecture     # 46 structural probes
npm run self-diagnosis          # 39 health checks
npm run done-check              # 77-step integrity gate
npm run rebuild-derived         # Nuke + rebuild derived edges
npm run graph:metrics           # Record GraphMetricsSnapshot
```

### Verification
```bash
npm run verification:scan       # Semgrep + ESLint → VR nodes (~30s)
```

### Enrichment
```bash
npm run enrich:test-coverage    # TESTED_BY edges
```

### Enforcement
```bash
codegraph enforce <files> --mode enforced
```

### Parse
```bash
codegraph parse .                          # MERGE mode
codegraph parse . --fresh                  # Destructive wipe + reparse
codegraph parse . --project-id <ID>        # Explicit project
```

### Plan ingestion
```bash
npx tsx src/core/parsers/plan-parser.ts /path/to/plans --ingest --enrich
```

---

## Playbooks

**Claim refresh:** `claim_generate` → `claims:cross:synthesize` → `claim_chain_path`
**Plan refresh:** `plan:refresh` → `edges:normalize` → `plan:evidence:recompute`
**Embedding tuning:** `plan:embedding:match --threshold=0.75 --limit=3` → `embedding:fp:verify` → target FP < 5%
**Failure recovery:** `PLAN_FRESHNESS_GUARD_FAILED` → run `plan:refresh`. `invariant_proof_completeness` fail → run `verification:proof:record`. Neo4j auth issues → check `.env`.

---

## Environment

```
NEO4J_URI=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=codegraph
OPENAI_API_KEY=required_for_embeddings  # in codegraph/.env
```

---

## What You Never Do

- Trust recall of what's tested or what risk tier something has. Query every time.
- Assume planned tasks link to files. Only done tasks have HAS_CODE_EVIDENCE.
- Skip Step 6. Post-implementation verification catches regressions tests miss.
- Use `--no-verify` casually.
- Optimize for speed over correctness.
- Work from memory across sessions. Read this file. Query the graph.
- Report partial enrichment as truth (SCAR-011).

---

## Quick Reference: Graph Knowledge Boundaries

| Question | Graph Can Answer? | How |
|----------|-------------------|-----|
| Next unblocked task? | ✅ | Task status + DEPENDS_ON |
| Which files does this task touch? | ✅ (done) / ❌ (planned) | Done: HAS_CODE_EVIDENCE. Planned: 0 evidence. |
| Is this file tested? | ✅ | TESTED_BY edges |
| Risk tier of functions? | ✅ | riskTier property |
| Should gate block this commit? | ✅ | `codegraph enforce` |
| What spec-test patterns exist? | ⚠️ Partial | TestFile nodes + disk search |
| Diagnosis output? | ❌ | Stdout only |
| What invariants must hold? | ❌ | Code only |
| Gate history? | ❌ | Not persisted |

---

κ = Φ ≡ Φ = ☧
