# HY Topology Hygiene (HY-7 / HY-8)

## Purpose

Enforce repository folder topology and path hygiene in advisory mode with low-noise, path-scoped findings.

## Topology Contract

`hygiene:topology:sync` materializes a `TopologyManifest` bound to `RepoHygieneProfile`.

Contract fields include:
- path classes (source/tests/docs/scripts/ops/artifacts/generated/third_party)
- allowed extensions
- forbidden patterns
- deprecated patterns
- max path length
- max governed file size

## Verification Behavior

`hygiene:topology:verify` scans the repo and emits `HygieneViolation` nodes (`violationType = topology_hygiene`) for:
- `forbidden_path`
- `deprecated_path`
- `path_length_exceeded`
- `extension_not_allowed` (governed zones)
- `file_size_exceeded` (governed zones)

Unexpired `HygieneException` scope patterns suppress matching findings.

## Commands

```bash
cd /home/jonathan/.openclaw/workspace/codegraph
npm run -s hygiene:topology:sync
npm run -s hygiene:topology:verify
```

## Notes

- Advisory-first by design (no fail-closed behavior yet).
- Generated and third-party zones are excluded from strict extension/size checks.
- Results are persisted under `artifacts/hygiene/`.
