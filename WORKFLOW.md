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
WHERE dep.status <> 'done'
WITH t, m, collect(dep.name) AS blockers
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

57+ steps. Must exit 0. If it fails, your task is not done.

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
- Verify the graph sees your changes: query the files you modified, confirm risk tiers and test coverage are current

---

## What You Never Do

- **Trust your recall of what's tested.** Query TESTED_BY every time.
- **Trust your recall of risk tiers.** Query riskTier every time.
- **Assume planned tasks link to files.** They don't — 0/433 have evidence.
- **Skip Step 8.** Post-implementation graph check catches regressions that tests alone miss.
- **Use `--no-verify` casually.** The gate exists for a reason.
- **Optimize for speed.** Optimize for not shipping slop.
- **Work from memory across sessions.** Read this file again. Query the graph again.

---

## Quick Reference: What the Graph Can and Cannot Tell You

| Question | Graph Can Answer? | How |
|----------|-------------------|-----|
| What's the next unblocked task? | ✅ | Task status + DEPENDS_ON |
| Which files does this task touch? | ❌ | Planned tasks have 0 code evidence |
| Is this file tested? | ✅ | TESTED_BY edges (93 edges, 47 files) |
| What's the risk tier of functions in this file? | ✅ | riskTier property on Function nodes |
| Should the gate block this commit? | ✅ | `codegraph enforce` or `enforceEdit` MCP tool |
| What spec-test patterns exist? | ⚠️ Partial | 53 TestFile nodes, but recent RF tests not in graph |
| What did diagnosis say? | ❌ | Stdout only, 0 AuditCheck nodes in graph |
| What invariants must hold? | ❌ | Code only, not graph nodes |
| What was blocked/approved last week? | ❌ | Gate decisions not persisted to graph |

When the graph can't answer, fall back to disk (file search, `find`, `grep`) or being told. Never fall back to inference.
