# AUDIT_PROFILE_STANDARD.md

Model-agnostic forensic audit profile for AnythingGraph governance/audit runs.

## Purpose

Define one deterministic protocol so "run an audit now" always resolves to the same required scope, commands, and output contract.

## Anchor policy

1. Resolve cross-repo anchor pair first (`codegraph` + workspace).
2. If both commits exist, use exact commit ranges from that pair.
3. If one side is missing, fail unless explicit fallback override is requested.
4. Every audit writes/updates the next anchor pair after successful closure.

Resolver command:

```bash
npm run -s audit:anchor:resolve
```

## Required command set (codegraph)

```bash
npm run -s done-check:strict:full
npm run -s commit:audit:verify -- <baseRef> <headRef>
npm run -s plan:deps:verify
npm run -s integrity:verify
npm run -s query:contract:verify
npm run -s governance:stale:verify
```

## Working-tree policy

- Commit-range audit alone is insufficient when working tree is dirty.
- `commit:audit:verify` must include working-tree delta summary.
- If `commitCount=0` and working tree is dirty, audit must fail unless explicit override env is set:

```bash
COMMIT_AUDIT_ALLOW_DIRTY=true
```

(Override usage must be recorded in artifact output.)

## Output contract (required sections)

1. Scope + exact ranges
2. Commits reviewed (all repos)
3. File/function-level findings
4. High-risk issues
5. Medium/low issues
6. False positives ruled out
7. Required fixes (ranked)
8. GO/NO-GO verdict

## Rolling replay policy (optional / recommended)

- Maintain last 3 audit checkpoints.
- Primary pass: last anchor..HEAD
- Replay pass: third-most-recent anchor..HEAD
- Classify findings as: `new`, `still_open`, `regressed`, `resolved`.
