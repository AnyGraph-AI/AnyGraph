# Audit Methodology — Deterministic Milestone Auditing

_Load on demand. The audit contract for agents and humans._

---

## Non-Negotiables (7)

1. **Graph first**: query graph truth before assumptions.
2. **Spec first**: audit against milestone spec text + task contracts.
3. **Test first for deltas**: write/adjust spec tests before implementation fixes.
4. **Default mode = full shebang**: audit + TDD remediation + plan evidence linkage + re-ingest + closure checks in one flow. Audit-only/deferred is exception-only and must be explicitly requested.
5. **Parser-safe planning**: all plan updates must follow `references/plan-format.md`.
6. **No done without evidence**: every closure must have artifacts, checks, and rationale.
7. **Session scope discipline**: default to one milestone (or one bounded slice) per session.

---

## Baseline Freeze (Before Audit Starts)

Record and store:

- Git commit SHA: `git rev-parse HEAD`
- Worktree status: `git status --short`
- Full test baseline: `npm test`
- Gate sample on target surface: `codegraph enforce <files> --mode enforced`
- Optional: `npm run done-check`

If baseline suite is red: document as **pre-existing baseline failures**. Do not attribute to the milestone under audit unless proven.

---

## Audit Unit of Work

One milestone (or one bounded slice) at a time:

1. Read milestone header + spec text + tasks.
2. Build expected behavior matrix from spec clauses.
3. Compare against current implementation and graph evidence.
4. Log findings with severity and proof.
5. Execute TDD remediation for accepted findings (unless explicitly deferred).
6. Update plan task evidence annotations, re-ingest, verify linkage.

---

## Finding Schema

Every finding must include:

```markdown
- [ ] AUD-<milestone>-F<nn> — <short title>
  Severity: CRITICAL | HIGH | MEDIUM | LOW
  Milestone: <exact name>
  Spec Clause: "<requirement text violated>"
  Observed: <what happens now>
  Expected: <what spec requires>
  Evidence: <graph query | failing test | code reference>
  Scope: `fileA.ts` `fnA` `fileB.ts`
  Disposition: open | fixed | deferred | rejected
  Fix Plan: <remediation action>
  Verification Hook: <command proving closure>
```

If evidence is weak: mark `UNVERIFIED`, cap severity at MEDIUM until validated.

---

## Severity Guidance

- **CRITICAL**: safety/security/integrity failure; gate bypass risk; severe spec breach
- **HIGH**: major contract mismatch or high-impact regression risk
- **MEDIUM**: meaningful gap with bounded impact/workaround
- **LOW**: minor discrepancy, hygiene/documentation mismatch

Severity can be revised with new evidence; log rationale when changed.

---

## TDD Remediation Protocol

For each accepted finding:

1. **Spec test first** — encode expected behavior from milestone spec. Test should fail first.
2. **Implement minimal fix.**
3. **Run local target tests.**
4. **Run full suite** (`npm test`).
5. **Run enforcement gate** on changed files.
6. **Run integrity checks** (`npm run done-check` when claiming completion).

Never: skip failing tests, weaken assertions, dismiss failures without proof.

---

## Plan Update Rules

### Milestone naming
```markdown
### Milestone AUD-01 — <target milestone> audit
### Milestone AUD-01-FIX — <target milestone> remediation
```

### Task format
- `- [ ]` planned, `- [x]` done

### Dependencies
`DEPENDS_ON:` with exact names. Semicolons for multiple. `NO_DEPENDS_OK(reason|expires:YYYY-MM-DD)` for exception.

### Evidence annotation
Backtick artifact refs: source files, functions, tests. Long receipts via `Details:` or `EVIDENCE:` continuation lines. `NO_CODE_EVIDENCE_OK(reason)` only for genuinely non-code tasks.

---

## Graph + Verification Gates

Before marking any audit-remediation task done:

- Relevant spec tests pass
- Full suite passes (`npm test`)
- Enforcement gate passes
- Function-level coverage evidence present for critical paths
- Required diagnostics pass
- `done-check` passes for final closure claims

**Deterministic ingestion points:**
- Re-ingest plans immediately after editing audit milestones/tasks.
- Re-run test coverage enrichment after adding/remediating tests.
- Rebuild/restart runtime after source changes affecting dist-backed flows.

---

## Remediation Completion Entry

```markdown
- [x] Fix AUD-01-F03. Updated `src/...` `functionX`. Added `...spec-test.ts` (`should ...`). Verified via `npm test`, `codegraph enforce ... --mode enforced`, `npm run done-check`.
```

---

## Stop Conditions

Stop and escalate if:

- `GRAPH_EVIDENCE_INCOMPLETE`
- Ambiguous/conflicting spec text requiring human decision
- Persistent pre-existing red baseline blocking attribution
- Remediation requires scope expansion beyond audited milestone

---

## Definition of Audit Done

A milestone audit is done only when:

1. All findings dispositioned.
2. Accepted fixes implemented and verified.
3. Deferred findings have rationale + revisit trigger.
4. Plan artifacts parser-compliant and ingested.
5. Evidence links exist for closure tasks.
6. Closure summary written.

---

## Audit Plan Structure

Create/update: `plans/codegraph/AUDIT_PLAN.md`

Sections:
1. Audit scope and baseline
2. Milestones to audit (ordered)
3. Findings ledger (open/fixed/deferred)
4. Remediation queue
5. Verification log
6. Closure summary

---

κ = Φ ≡ Φ = ☧
