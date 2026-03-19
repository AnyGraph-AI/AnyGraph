# AUDIT_PRIMING.md — CodeGraph Audit Operating Procedure

Purpose: define a deterministic, graph-first, parser-safe audit workflow for milestone-by-milestone auditing, remediation, and closure.

This file is the audit contract for agents and humans.

---

## 0) Non-Negotiables

1. **Graph first**: query graph truth before assumptions.
2. **Spec first**: audit against milestone spec text + task contracts.
3. **Test first for deltas**: write/adjust spec tests before implementation fixes.
4. **Default mode = full shebang**: audit + TDD remediation + plan evidence linkage + re-ingest + closure checks in one flow. `Audit-only/deferred` is exception-only and must be explicitly requested.
5. **Parser-safe planning**: all plan updates must follow `PLAN_FORMAT.md`.
6. **No done without evidence**: every closure must have artifacts, checks, and rationale.
7. **Session scope discipline**: default to one milestone (or one bounded milestone slice) per session to preserve attribution and reduce drift.

References:
- `WORKFLOW.md`
- `AGENTS.md`
- `PLAN_FORMAT.md`
- `plans/codegraph/VERIFICATION_GRAPH_ROADMAP.md`

---

## 1) Baseline Freeze (Before Audit Starts)

Record and store baseline in audit artifacts:

- Git commit SHA (`git rev-parse HEAD`)
- Worktree status (`git status --short`)
- Full test baseline (`npm test`)
- Enforcement gate sample on target surface (`npx tsx src/scripts/entry/enforce-edit.ts <files> --mode enforced`)
  - Optional wrapper (if available in PATH): `codegraph enforce <files> --mode enforced`
- Optional integrity baseline (`npm run done-check`)

If baseline test suite is red:
- Document failures as **pre-existing baseline failures**.
- Do not attribute these to the milestone under audit unless proven.

---

## 2) Audit Unit of Work

Audit one milestone (or one bounded milestone slice) at a time.

For each milestone:
1. Read milestone header + spec text + tasks.
2. Build expected behavior matrix from spec clauses.
3. Compare against current implementation and graph evidence.
4. Log findings with severity and proof.
5. Execute TDD remediation for accepted findings in the same flow (unless explicitly deferred).
6. Update plan task evidence annotations (files/functions/tests), re-ingest, and verify linkage.

Do not audit multiple milestones in one unstructured pass.

---

## 3) Required Finding Schema

Every finding must include:

- **Finding ID**: `AUD-<milestone>-F<nn>`
- **Milestone**: exact milestone name
- **Severity**: CRITICAL | HIGH | MEDIUM | LOW
- **Spec Clause**: exact requirement text (or task text) violated
- **Observed Behavior**: what happens now
- **Expected Behavior**: what spec requires
- **Evidence**:
  - graph query result OR
  - failing test name/output OR
  - code reference (`file`, function)
- **Scope**: impacted files/functions/modules
- **Disposition**: open | fixed | deferred | rejected
- **Fix Plan**: brief remediation action
- **Verification Hook**: command/test proving closure

If evidence is weak, mark `UNVERIFIED` and cap severity at MEDIUM until validated.

---

## 4) TDD Remediation Protocol

For each accepted finding:

1. **Spec test first**
   - create/update a test that encodes expected behavior from milestone spec
   - test should fail first when practical
2. **Implement minimal fix**
3. **Run local target tests**
4. **Run full suite** (`npm test`)
5. **Run enforcement gate** on changed files
6. **Run required integrity checks** (`npm run done-check` when claiming completion)

Never:
- skip failing tests,
- weaken assertions to force green,
- dismiss a failure as “earlier implementation” without proof.

---

## 5) Plan Update Rules (PLAN_FORMAT.md Compliant)

Audit tracking must be parser-safe.

### 5.1 Milestone naming
Use explicit audit milestones in plan files:

- `### Milestone AUD-01 — <target milestone> audit`
- `### Milestone AUD-01-FIX — <target milestone> remediation`

### 5.2 Task format
Use checkboxes only:

- `- [ ]` planned
- `- [x]` done

### 5.3 Dependencies
Use `DEPENDS_ON:` directives with exact task/milestone names.
Use semicolons for multiple dependencies.
Use `NO_DEPENDS_OK(reason|expires:YYYY-MM-DD)` only when a task is intentionally dependency-free and policy permits exception handling.

### 5.4 Evidence annotation
When a task is done, append backtick artifact refs:

- source files: `` `src/...` ``
- functions/components: `` `functionName` ``
- tests: `` `...spec-test.ts` `` with key test names

Use `NO_CODE_EVIDENCE_OK(reason)` only for tasks that genuinely produce no code artifacts.

---

## 6) Suggested Audit Plan Structure

Create/update: `plans/codegraph/AUDIT_PLAN.md`

Recommended sections:

1. Audit scope and baseline
2. Milestones to audit (ordered)
3. Findings ledger (open/fixed/deferred)
4. Remediation queue
5. Verification log
6. Closure summary

Keep each milestone self-contained and dependency-linked.

---

## 7) Graph + Verification Gates

Minimum required before marking any audit-remediation task done:

- Relevant spec tests pass
- Full suite passes (`npm test`)
- Enforcement gate passes (`ALLOW` or approved `REQUIRE_APPROVAL` context)
- Function-level coverage evidence is present for touched critical paths (e.g., `TESTED_BY_FUNCTION` / `hasTestCaller`)
- Required diagnostics pass for claimed scope
- `done-check` passes for final closure claims

Deterministic ingestion points:
- Re-ingest plan updates immediately after editing audit milestones/tasks.
- Re-run test coverage enrichment immediately after adding/remediating tests.
- Rebuild/restart runtime readers after source changes that affect dist-backed flows.

---

## 8) Output Templates

### 8.1 Audit Finding Entry

```md
- [ ] AUD-01-F03 — <short title>
  Severity: HIGH
  Milestone: <name>
  Spec Clause: "..."
  Observed: ...
  Expected: ...
  Evidence: `query-id` / `test-name` / `file:function`
  Scope: `fileA.ts` `fnA` `fileB.ts`
  Fix Plan: ...
  Verification Hook: `npm test -- ...`
```

### 8.2 Remediation Completion Entry

```md
- [x] Fix AUD-01-F03. Updated `src/...` `functionX`. Added `...spec-test.ts` (`should ...`). Verified via `npm test`, `codegraph enforce ... --mode enforced`, `npm run done-check`.
```

---

## 9) Severity Guidance

- **CRITICAL**: safety/security/integrity failure; gate bypass risk; severe spec breach
- **HIGH**: major contract mismatch or high-impact regression risk
- **MEDIUM**: meaningful gap with bounded impact/workaround
- **LOW**: minor discrepancy, hygiene/documentation mismatch

Severity can be revised with new evidence; log rationale when changed.

---

## 10) Stop Conditions

Stop and escalate if any occur:

- `GRAPH_EVIDENCE_INCOMPLETE`
- ambiguous or conflicting spec text requiring human decision
- persistent pre-existing red baseline that blocks attribution
- remediation requires architectural scope expansion beyond audited milestone

---

## 11) Definition of Audit Done (Per Milestone)

A milestone audit is done only when:

1. all findings are dispositioned,
2. accepted fixes are implemented and verified,
3. deferred findings have explicit rationale + revisit trigger,
4. plan artifacts are parser-compliant and ingested,
5. evidence links exist for closure tasks,
6. closure summary is written.

---

## 12) First Run Checklist

- [ ] Freeze baseline
- [ ] Select first milestone
- [ ] Generate expected behavior matrix from spec
- [ ] Run gap analysis (graph + tests + code)
- [ ] Create findings ledger entries
- [ ] Prioritize remediation queue
- [ ] Execute TDD fixes
- [ ] Verify + ingest + summarize
