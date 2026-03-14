# Python Parser Scaffolding Provenance

## Upstream starting point

We used the **ChrisRoyse/CodeGraph** multi-language direction as the starting scaffold reference for Python parser lane design:

- Repo: https://github.com/ChrisRoyse/CodeGraph
- Referenced capability: Python via native AST + graph ingestion in a multi-language architecture.

## What we adopted

- Python-first AST extraction model (`python3` AST lane)
- Multi-language parser posture (Python lane as peer to TS lane)
- Graph-oriented parser output strategy

## What we changed for AnythingGraph

- Emit **IR v1** contract (`ir.v1`) instead of direct arbitrary graph writes
- Preserve governance metadata (`parserTier`, `confidence`, `provenanceKind`, `sourceRevision`)
- Sidecar diagnostics integration (`pyright` probe metadata)
- Materialization through existing `ir-materializer` pipeline

## Concrete implementation files

- `src/core/parsers/python-parser.ts`
- `src/utils/python-parser-ingest.ts`
- `package.json` script: `python:parse:ir`
