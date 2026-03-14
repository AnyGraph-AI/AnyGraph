# HY Platform Parity Hygiene (HY-18)

## Purpose

Verify parity between graph-declared hygiene posture and repository platform controls.

## Current checks

`hygiene:platform:verify` captures:
- CODEOWNERS existence in repo
- GitHub branch protection status for default branch (when `GITHUB_TOKEN` available)
- GitHub rulesets availability/count (when `GITHUB_TOKEN` available)
- required reviews / required status checks presence (when API access available)

Outputs:
- `HygieneViolation` (`violationType = platform_parity`) for hard drift (e.g., missing CODEOWNERS, missing branch protection)
- `HygieneMetricSnapshot` (`metricFamily = platform_parity`) for audit/reporting lineage

## Command

```bash
cd /home/jonathan/.openclaw/workspace/codegraph
npm run -s hygiene:platform:verify
```

## Notes

- Advisory-first by default (`HYGIENE_PLATFORM_PARITY_ENFORCE=false`).
- If GitHub API is unavailable/tokenless, check state is recorded as `unknown`/`unavailable:*` rather than silently skipped.
