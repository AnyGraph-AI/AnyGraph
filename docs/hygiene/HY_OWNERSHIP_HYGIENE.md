# HY Ownership Hygiene (HY-5 / HY-6)

## Purpose

Introduce graph-native ownership scope bindings with freshness metadata and advisory violation output for unowned or stale-owned critical paths.

## Data Model

- `Owner`
  - `ownerType` = `person | team | service`
  - `handle`, `ownerVerifiedAt`, `reviewCadenceDays`
- `OwnershipScope`
  - `scopePattern` (CODEOWNERS pattern)
  - `scopeKind = codeowners_pattern`
  - `ownerVerifiedAt`, `backupOwner`, `escalationPath`, `reviewCadenceDays`
  - `criticalMatchCount`
- `HygieneViolation`
  - `violationType = ownership_hygiene`
  - subtypes: `unowned_critical_path`, `stale_owner_verification`

## Relationships

- `(Owner)-[:OWNS_SCOPE]->(OwnershipScope)`
- `(OwnershipScope)-[:APPLIES_TO]->(SourceFile)`
- `(Owner)-[:HAS_OWNER]->(SourceFile)`
- `(HygieneControl {code:'B2'})-[:APPLIES_TO]->(OwnershipScope)`
- `(HygieneViolation)-[:TRIGGERED_BY]->(HygieneControl {code:'B2'})`

## Commands

```bash
cd /home/jonathan/.openclaw/workspace/codegraph
npm run -s hygiene:ownership:sync
npm run -s hygiene:ownership:verify
```

## Verification Expectations

- CODEOWNERS entries materialize into OwnershipScope nodes.
- Critical paths (core/parser/verification/package policy surfaces) have at least one owner.
- Stale ownership checks are computed using `OWNERSHIP_STALE_DAYS` (default 45).
- Violations are emitted as `HygieneViolation` nodes and persisted to `artifacts/hygiene/`.
