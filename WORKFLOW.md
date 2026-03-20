# WORKFLOW.md — Graph-First Task Execution

**Read this before starting any task. No exceptions.**

The graph is the source of truth. Not your recall. Not your inference. Not your context window.
Every step below includes the exact query to run. If you skip a query and trust your memory instead, you will ship slop.

---

## Step 0: Orient (Session Boot / Cold Start)

If you're starting a new session or just loaded this file, run these 4 queries first:

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

After these 4 queries you know: what exists, what's dangerous, and what's left to do. You're oriented.

---

## Step 1: Find the Next Task

Query the graph for the next unblocked planned task:

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

Read the task name. Read the milestone spec text. That tells you WHAT to do.

**The graph cannot tell you WHICH FILES the task will touch.** Planned tasks have zero HAS_CODE_EVIDENCE edges (evidence is created after work, not before). You must determine the relevant source files from the task description, codebase search, or being told.

---

## Step 2: Identify Affected Files

Search the codebase for files related to the task:

```bash
grep -rl "relevant_keyword" src/ --include="*.ts" | grep -v node_modules | grep -v __tests__ | grep -v ".test." | sort
```

Or use the MCP tool: `searchCodebase` with a natural language description.

List every file you expect to read or modify. Be explicit. Don't guess later.

---

## Step 3: Query File Risk and Test Coverage

For every file you identified in Step 2:

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

**Check for files NOT IN GRAPH.** If a file you plan to touch returns zero results, the graph is stale for that file. Reparse before proceeding:

```bash
cd codegraph && npx tsx src/cli/cli.ts parse . --project-id proj_c0d3e9a1f200
npm run rebuild-derived
npm run enrich:test-coverage
```

---

## Step 4: Run the Enforcement Gate

Run the gate on the files you'll touch BEFORE writing any code:

```bash
cd codegraph && npx tsx src/scripts/entry/enforce-edit.ts \
  /absolute/path/to/file1.ts \
  /absolute/path/to/file2.ts \
  --mode enforced
```

Read the output:

| Gate Result | What It Means | What You Do |
|-------------|---------------|-------------|
| ✅ ALLOW (exit 0) | No CRITICAL functions, or all CRITICAL are tested | Proceed to Step 6 |
| ⚠️ REQUIRE_APPROVAL (exit 2) | CRITICAL functions exist, all tested | Proceed with awareness — you're touching dangerous code |
| 🚫 BLOCK (exit 1) | Untested CRITICAL functions | **STOP. Go to Step 5.** |

---

## Step 5: Write Prerequisite Tests (If Gate Blocks)

If the gate returned BLOCK, there are CRITICAL functions in untested files. You must test them BEFORE writing any task code.

These are NOT TDD tests for the new feature. These are coverage tests for EXISTING code that you're about to modify. The code exists, the tests don't.

1. Find which files lack TESTED_BY:
```cypher
MATCH (sf:SourceFile {projectId: $projectId})-[:CONTAINS]->(f:Function)
WHERE sf.filePath IN $filePaths AND f.riskTier = 'CRITICAL'
AND NOT EXISTS { MATCH (sf)-[:TESTED_BY]->() }
RETURN sf.name AS file, collect(f.name) AS untestedCriticals
```

2. Write tests for those files. Import from the source file. Test the existing behavior.

3. Run the tests: `npm test`

4. Commit the prerequisite tests (gate should now allow — the files have TESTED_BY).

5. Re-run enrichment so the graph sees the new coverage:
```bash
npm run enrich:test-coverage
```

6. Re-run the gate. If it still blocks, you missed something. Loop back.

---

## Step 6: Write TDD Spec Tests From the Spec

Now write tests for the NEW functionality described in the task.

**Write from the spec, not from code.** The task name and milestone spec text describe what SHOULD happen. Your tests encode that contract. They should FAIL because the implementation doesn't exist yet.

### Find existing patterns:

The graph knows which test files cover which source files:
```cypher
MATCH (sf:SourceFile {projectId: $projectId})-[:TESTED_BY]->(tf:TestFile)
RETURN sf.name AS sourceFile, collect(tf.name) AS testFiles
ORDER BY sf.name
```

But recent spec-test files (RF-6 through RF-9) are NOT in the graph — parser excludes test files. Check disk:
```bash
find src -name "*.spec-test.ts" | sort
```

Use the most recent spec-test in the same milestone family as your template.

### Naming convention:
- `rf10-entropy-monitoring.spec-test.ts` for RF-10
- Located in `src/core/test-harness/__tests__/semantic/`

### Structure:
```typescript
/**
 * RF-10: Entropy Monitoring — Spec Tests
 *
 * Tests written FROM the VERIFICATION_GRAPH_ROADMAP.md RF-10 spec.
 *
 * Spec requirements:
 * 1. [requirement from task name]
 * 2. [requirement from task name]
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
// ... imports from source files

describe('RF-10: Entropy Monitoring', () => {
  // Task-numbered sections
  // Tests that FAIL before implementation
});
```

Run: `npm test` — spec tests should fail. If they pass, your tests aren't testing the new functionality.

---

## Step 7: Write the Implementation

Write the code that makes the TDD spec tests pass.

Run: `npm test` — all tests (existing + new) should pass.

### Route cold-start UX invariant (for new pages/routes)
If you add a route that depends on query params/state (example: `/explorer?focus=...`), you must ship all three:
1. Cold-start empty state (clear message, not blank canvas)
2. Default seed fallback OR explicit CTA to select a target
3. Test coverage for no-param behavior

No route is complete if direct-load UX is ambiguous or appears broken.

### When a pre-existing test breaks (NON-NEGOTIABLE)

If an existing test fails after your implementation, **STOP.** Do not dismiss it. Do not say "this tests an earlier implementation." Diagnose it:

1. **Read the test.** What behavior is it asserting? Is it testing a contract (input→output, API shape, invariant) or an implementation detail (internal structure, mock wiring)?

2. **Read your diff.** What did you change that could have caused this failure?

3. **Determine the verdict:**

| Situation | Verdict | Action |
|-----------|---------|--------|
| Your change intentionally altered the behavior the test verifies | **Spec changed** | Update the test to match the new spec. Document WHY in the commit message. |
| The test was asserting implementation details that your refactor legitimately changed (e.g., internal data structure, mock shape) | **Test was brittle** | Rewrite the test to assert the contract, not the implementation. The behavior didn't change — the test was wrong. |
| You don't understand why it broke | **Investigate** | Do NOT proceed. Read the source. Trace the call chain. Ask if stuck. |
| The test catches a real regression your code introduced | **Your code is wrong** | Fix your code, not the test. |

**What you NEVER do:**
- Skip the test (`--skip`, `.skip`, commenting out)
- Delete the test
- Weaken the assertion to make it pass
- Say "this is from an earlier implementation" without proving the spec changed
- Say "this break is from earlier, not from my changes" — if it was broken before you started, you should have caught it in Step 0. If you didn't verify the suite was green before starting, you can't claim the break isn't yours.
- Proceed with failing tests and promise to fix later

**The principle:** A breaking test is a signal, not an obstacle. TDD means the tests define the contract. If you change the contract, you change the test AND document why. If you didn't intend to change the contract, your code has a bug. There is no third option.

**Pre-existing failures:** If `npm test` has failures BEFORE you start work, document them (test name, error) and fix them or flag them to the human. Do not start implementation on a red suite — you lose the ability to distinguish your regressions from pre-existing ones. A green baseline is a precondition, not a nice-to-have.

---

## Step 7b: Annotate Task with Artifacts

Before marking the task done, update its text in the plan file with backtick references to every file, function, and test artifact produced.

### Why:
The plan parser extracts backtick identifiers and creates HAS_CODE_EVIDENCE edges. Without annotation, evidence linking relies on fuzzy keyword matching. With annotation, the graph gets surgical links from tasks to the exact code they produced.

### How:

1. Check what you touched:
```bash
git diff --name-only HEAD~1
```

2. List new exports/functions you created (check the diff or source files).

3. Append to the task line in the plan file. Include:
   - **Source files** created or modified: `PainHeatmap.tsx`, `queries.ts`
   - **Functions/components** created: `PainHeatmap`, `computeBasePain`
   - **Test files**: `ui2-pain-heatmap.test.ts`
   - **Test names** (key ones): `exports a PainHeatmap component`

### Example:

**Before:**
```markdown
- [x] Build Recharts Treemap component with dual color encoding
```

**After:**
```markdown
- [x] Build Recharts Treemap component with dual color encoding. Created `PainHeatmap.tsx` with `PainHeatmap` component. Updated `page.tsx` `Dashboard`. Added `painHeatmap` query to `queries.ts`. Tests: `ui2-pain-heatmap.test.ts` (`exports a PainHeatmap component`, `returns treemap-compatible data from live graph`).
```

### Rules:
- Keep the first checkbox line parser-friendly (short action statement).
- Put long explanation in continuation lines prefixed with `Details:` or `EVIDENCE:`.
- Every file touched gets a backtick reference.
- Every new function/export gets a backtick reference.
- Every test file gets a backtick reference with key test names.
- Continuation lines are parsed for evidence refs (prose-safe), so long receipts are allowed when structured.
- Do not rely on plain prose without backticks; explicit refs are still the canonical linkage path.
- Don't skip this step — it's the receipt system. Future agents and the graph depend on it.
- When M8 (evidenceRole semantics) lands, these annotations enable `target` vs `proof` classification automatically.

---

## Step 8: Query the Graph Again

**This is the step you will be tempted to skip. Don't.**

After implementation, check for regressions and new gaps:

### 8a. New untested CRITICAL functions?
```cypher
MATCH (sf:SourceFile {projectId: $projectId})-[:CONTAINS]->(f:Function)
WHERE sf.filePath IN $changedFiles AND f.riskTier = 'CRITICAL'
AND NOT EXISTS { MATCH (sf)-[:TESTED_BY]->() }
RETURN f.name AS untestedCritical, sf.name AS file
```

If your implementation added new CRITICAL functions in untested files → write tests before submitting.

### 8b. Run the gate on all changed files:
```bash
npx tsx src/scripts/entry/enforce-edit.ts $CHANGED_FILES --mode enforced
```

### 8c. Full test regression:
```bash
npm test
```

All tests must pass. No exceptions. No `--skip`. No "I'll fix it later."

### 8d. Run self-diagnosis:
```bash
npm run self-diagnosis
```

Note: diagnosis output goes to stdout only, not to the graph. Check for new red checks that weren't red before your changes.

### 8e. Run done-check:
```bash
npm run done-check
```

77 steps. Must exit 0. If it fails, your task is not done.

**⚠️ Partial enrichment trap:** If you need quick numbers mid-task, running individual enrichment scripts (e.g., `enrich:composite-risk` alone) produces misleading output because enrichment steps have dependencies. Composite-risk consumes temporal-coupling flags; precompute-scores consumes composite-risk output. Skipping upstream steps = stale inputs = wrong numbers. Use `done-check` for authoritative metrics.

**Delegation rule:** if the human explicitly says someone else is running `done-check`, do **not** run it locally.
Record status as: `done-check delegated / pending external result` and continue with all non-done-check verification and evidence linkage.

### 8f. Whole-shebang evidence closure check (mandatory)
Before claiming milestone/task closure, prove graph evidence completeness:

```cypher
MATCH (m:Milestone {projectId:'plan_codegraph'})
WHERE m.name CONTAINS $milestoneName
MATCH (t:Task)-[:PART_OF]->(m)
WITH t
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

Closure requirements:
- `doneWithoutEvidence = 0`
- Evidence includes all three families where applicable: `SourceFile`, `Function`, `TestFile`
- If a family is intentionally absent, document why in milestone notes.

### 8g. Long-run pipeline handling (operator visibility)
For heavy commands (`done-check`, full enrichment, large reparses):
- Run with enough wait/poll budget to avoid fake "hung" status.
- Provide progress updates every ~2-3 minutes with current step.
- If runtime exceeds expectation, offer explicit choice: continue / stop / delegate.

---

## Step 9: Submit

Only after Steps 1–8 are clean:

```bash
git add <files>
git commit -m "RF-10: description of what was done"
```

The pre-commit hook runs the enforcement gate automatically. If it blocks, you missed something in Step 8. Go back. Don't use `--no-verify` unless you have a specific, documented reason.

After commit:
- Re-run `npm run enrich:test-coverage` (so TESTED_BY edges update for your new test files)
- Re-run `npm run verification:scan` (so VR nodes and ANALYZED edges are fresh — without this, all functions keep `NO_VERIFICATION` flag and LOWs vanish)
- Verify the graph sees your changes: query the files you modified, confirm risk tiers and test coverage are current

---

## Graph Write Lock (Multi-Agent)

When multiple agents share this codebase, all commands that **write to Neo4j** must be wrapped with `flock` to prevent concurrent graph mutations:

```bash
flock /tmp/codegraph-pipeline.lock npm run done-check
flock /tmp/codegraph-pipeline.lock npm run enrich:composite-risk
flock /tmp/codegraph-pipeline.lock npm run rebuild-derived
flock /tmp/codegraph-pipeline.lock npx tsx src/core/parsers/plan-parser.ts ... --ingest
flock /tmp/codegraph-pipeline.lock npm run verification:scan
```

**How it works:** `flock` is a Linux kernel-level file lock. If another agent holds the lock, your process **sleeps** until they finish. No race conditions, no advisory honor system. Lock releases automatically if the holder crashes.

**Non-blocking mode** (skip instead of wait):
```bash
flock -n /tmp/codegraph-pipeline.lock npm run done-check || echo "Pipeline locked, skipping"
```

**What needs the lock:**
- Any `npm run enrich:*` command
- `npm run done-check` / `done-check:core`
- `npm run rebuild-derived`
- `npm run verification:scan`
- Plan parser `--ingest`
- Any script that writes nodes, edges, or properties to Neo4j

**What does NOT need the lock:**
- Read-only Cypher queries (`MATCH ... RETURN`)
- File edits, test runs, builds
- `npm test`, `npm run build`
- `enforce-edit` (read-only gate check)

**Critical rule:** All agents must use the same lockfile path (`/tmp/codegraph-pipeline.lock`). If one agent uses a different path, the lock doesn't protect against it.

---

## What You Never Do

- **Trust your recall of what's tested.** Query TESTED_BY every time.
- **Trust your recall of risk tiers.** Query riskTier every time.
- **Assume planned tasks link to files.** Done tasks have HAS_CODE_EVIDENCE (200 edges), but planned tasks have 0.
- **Skip Step 8.** Post-implementation graph check catches regressions that tests alone miss.
- **Use `--no-verify` casually.** The gate exists for a reason.
- **Optimize for speed.** Optimize for not shipping slop.
- **Work from memory across sessions.** Read this file again. Query the graph again.

---

## Quick Reference: What the Graph Can and Cannot Tell You

| Question | Graph Can Answer? | How |
|----------|-------------------|-----|
| What's the next unblocked task? | ✅ | Task status + DEPENDS_ON |
| Which files does this task touch? | ✅ (done tasks) / ❌ (planned) | Done tasks have backtick annotations → HAS_CODE_EVIDENCE. Planned tasks have 0 evidence. |
| Is this file tested? | ✅ | TESTED_BY edges (118 tested files, 105 TestFile nodes) |
| What's the risk tier of functions in this file? | ✅ | riskTier property on Function nodes |
| Should the gate block this commit? | ✅ | `codegraph enforce` or `enforceEdit` MCP tool |
| What spec-test patterns exist? | ⚠️ Partial | 105 TestFile nodes in graph, but recent spec tests may lag |
| What did diagnosis say? | ❌ | Stdout only, 0 AuditCheck nodes in graph |
| What invariants must hold? | ❌ | Code only, not graph nodes |
| What was blocked/approved last week? | ❌ | Gate decisions not persisted to graph |

When the graph can't answer, fall back to disk (file search, `find`, `grep`) or being told. Never fall back to inference.
