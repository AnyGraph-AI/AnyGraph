# HY Proof-of-Done Hygiene (HY-14 / HY-15)

## Purpose

Define critical change scope and enforce done-without-evidence detection for scoped milestones.

## Scope Contract

`hygiene:proof:scope:sync` creates `ProofOfDoneScope` with:
- critical milestone selectors
- required evidence classes
- negative rules (plan-only or code-only insufficiency for critical done/promotion)

## Verification

`hygiene:proof:verify`:
- scans done tasks in scoped critical milestones
- requires `HAS_CODE_EVIDENCE` for done tasks in scope
- emits `HygieneViolation` (`violationType = proof_of_done`, subtype `done_without_evidence`)
- materializes `HygieneMetricSnapshot` for proof coverage by plan project and milestone family

## Commands

```bash
cd /home/jonathan/.openclaw/workspace/codegraph
npm run -s hygiene:proof:scope:sync
npm run -s hygiene:proof:verify
```

## Expected Gate Behavior

- `done_without_evidence = 0` for scoped critical tasks.
- Proof coverage snapshots are reproducible (payload hash + JSON payload).
- Violations are advisory-first in this stage; strict promotion can consume this signal later.
