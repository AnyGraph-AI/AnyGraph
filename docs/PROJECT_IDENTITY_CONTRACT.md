# Project Identity Contract (Canonical)

This document freezes the canonical identity contract for `:Project` nodes.

## Required fields (all `:Project` nodes)

- `projectId` (unique identifier)
- `displayName`
- `projectType` (`code|corpus|plan|document|meta`)
- `sourceKind` (`parser|plan-ingest|corpus-ingest|manual|derived`)
- `status` (`active|paused|archived|error`)
- `updatedAt` (ISO timestamp)
- `nodeCount` (non-negative integer)
- `edgeCount` (non-negative integer)

## `projectId` format policy

Regex:

```regex
^(proj|plan)_[a-z0-9_]+$
```

Rules:
- prefix with domain family: `proj_` or `plan_`
- lowercase alphanumeric + underscore only
- immutable after creation
- must be unique

## Examples

Valid:
- `proj_c0d3e9a1f200`
- `proj_bible_kjv`
- `proj_quran`
- `plan_codegraph`
- `plan_runtime_graph`

Invalid:
- `Proj_CodeGraph` (uppercase)
- `proj-codegraph` (hyphen)
- `codegraph` (missing family prefix)
- `plan:codegraph` (invalid separator)

## Enforcement

- Runtime updater/backfill: `reconcile-project-registry.ts`
- Contract validator (fail-closed): `verify-project-identity-contract.ts`
- Included in `done-check` gate via `registry:identity:verify`
