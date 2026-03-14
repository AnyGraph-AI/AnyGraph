# H0 Execution Runbook — Repository Hygiene (HY)

Scope: Execute high-signal HY controls first with evidence-backed completion.

## Order of Execution

1. HY-1 → HY-4 (foundation)
2. HY-5 + HY-6 (ownership enforcement)
3. HY-7 + HY-8 (folder/path hygiene, advisory first)
4. HY-14 + HY-15 (proof-of-done enforcement)
5. HY-16 + HY-17 (exception governance)
6. HY-18 (platform parity drift)

## Evidence Contract (per milestone)

A milestone can be marked done only when all are present:

- Implementation artifact(s): code/schema/contract committed
- Verification artifact(s): command output proving behavior
- Graph artifact(s): query output proving expected nodes/edges/metrics
- Negative test (where applicable): failure mode demonstrated and blocked

## Required Verification Commands

```bash
cd /home/jonathan/.openclaw/workspace/codegraph
npm run -s plan:refresh
npm run -s plan:deps:verify
```

## Milestone-Specific Done Checks

### HY-1..HY-4 Foundation
- Domain boundary and non-goals documented and linked
- Hygiene failure classes and success signals defined
- Hygiene registry schema versioned
- RepoHygieneProfile contract exists with inheritance/version behavior

### HY-5..HY-6 Ownership
- Ownership bindings queryable by critical path scope
- Stale/unowned findings emitted in advisory output
- CODEOWNERS parity checks present where supported

### HY-7..HY-8 Folder/Path
- Canonical path classes exist per profile
- Path/size/extension violations detected path-scoped
- Expiring exception model used for bypasses

### HY-14..HY-15 Proof-of-Done
- Critical change classes defined
- Required evidence classes enforced before done/promotion
- Done-without-evidence blocked and captured as violation

### HY-16..HY-17 Exceptions
- Exception schema includes reason/approver/ticket/expiry/scope/hash
- Expired exceptions fail by default
- Renewal/revocation flow emits audit evidence

### HY-18 Platform Parity
- Rulesets/CODEOWNERS/review/status posture checked
- Policy-vs-platform drift emitted as first-class violation

## Promotion Gate Beyond H0

Do not promote beyond H0 unless:
- H0 acceptance checks all green
- Advisory output remains low-noise and path-scoped
- plan:deps:verify remains clean
