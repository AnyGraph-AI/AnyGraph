# Governance Strict Rollout + Rollback Runbook

## Scope

Strict-mode rollout for governance gates:

- `STRICT_SCOPED_DEPENDS_ON`
- `DOCUMENT_WITNESS_ENFORCE`
- `GOVERNANCE_METRICS_ENFORCE`

## Rollout phases

### Phase 1 — Nightly strict smoke

Command:

```bash
npm run done-check:strict:smoke
```

Flags:

- `STRICT_SCOPED_DEPENDS_ON=true`
- `DOCUMENT_WITNESS_ENFORCE=false`
- `GOVERNANCE_METRICS_ENFORCE=false`

Goal: validate dependency hygiene under strict parsing without hard-failing document/metrics contracts.

Note: strict smoke/full commands now chain capture-only runtime proof (`verification:done-check:capture:only`).

### Phase 2 — CI strict smoke (merge gate candidate)

Command:

```bash
npm run done-check:strict:smoke
```

Promotion criteria (minimum):

- 5 consecutive green strict-smoke runs
- `scopedMissingDepends = 0`
- no unexpected drift alarms

### Phase 3 — Full strict (always-on candidate)

Command:

```bash
npm run done-check:strict:full
```

Flags:

- `STRICT_SCOPED_DEPENDS_ON=true`
- `DOCUMENT_WITNESS_ENFORCE=true`
- `GOVERNANCE_METRICS_ENFORCE=true`

Promotion criteria (minimum):

- 5 consecutive green full-strict runs
- governance metric integrity `advisoryOk=true`
- document wording contract status `open|restricted` with no violation

## Rollback policy

Rollback from strict full to strict smoke (or default) when any trigger hits:

1. `governance:metrics:integrity:verify` reports:
   - `interceptionDrop > 0.2`, or
   - `recoveryIncrease > 2`, or
   - `advisoryOk=false` under strict mode
2. `document:witness:advisory` fails under enforce mode
3. `plan:deps:verify` fails due to missing scoped dependencies (including GM-8 done-without-evidence guard).

Rollback command (safe mode):

```bash
npm run done-check:strict:smoke
```

If still unstable, fallback to default:

```bash
npm run done-check
```

## Operator checklist

- Run `governance:metrics:report` and confirm strict/operational consistency.
- Confirm `document:namespace:verify` and `document:wording:verify` are green.
- Confirm latest metric snapshot includes `metricHash` and canonical fields.
- Confirm freshness check source is current (`VerificationRun.ranAt` or `GovernanceMetricSnapshot.timestamp`).
- For local dirty worktrees only, use explicit override for capture step: `VERIFICATION_CAPTURE_ALLOW_DIRTY=true`.

## Canonical metric notes

- Primary: `preventedRuns = count(distinct run)`
- Diagnostic: `preventedEdgesDiagnostic = count(distinct rel)`
- Never substitute one for the other in KPI headlines.
