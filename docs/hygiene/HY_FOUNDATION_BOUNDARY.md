# HY Foundation Boundary (HY-1..HY-4)

Purpose: define the hygiene domain as a control plane that consumes existing governance/runtime evidence primitives.

## Ownership Split

- **governance-org** owns architecture primitives (ORG/EVT/RED/REL):
  - organization/repo model
  - event schema and projection/reducer architecture
  - check-run integration and rollup infrastructure
- **hygiene** owns policy contracts and enforcement posture:
  - hygiene failure classes
  - hygiene control registry and mappings
  - repository hygiene profiles
  - advisory/strict promotion criteria and control retirement logic

## Required Existing Evidence Entities (bound, not duplicated)

Hygiene controls must consume existing graph entities:

- `Project` (repo anchor)
- `VerificationRun`
- `GateDecision`
- `CommitSnapshot`
- `Artifact`
- `DocumentWitness`

## Explicit Non-Goals

- Do not define alternate event/reducer architecture under hygiene.
- Do not define duplicate runtime evidence entities outside existing verification ingest paths.
- Do not replace project identity or repo boundary semantics owned by governance-org.

## Bootstrap + Verification Commands

```bash
cd /home/jonathan/.openclaw/workspace/codegraph
npm run -s hygiene:foundation:sync
npm run -s hygiene:foundation:verify
```
