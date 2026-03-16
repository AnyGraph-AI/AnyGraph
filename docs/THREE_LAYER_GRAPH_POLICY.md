# Three-Layer Graph Modeling Policy

## Layer 1: Canonical (Immutable Observations)
Parser-produced nodes and edges. Source of truth from code/plan/corpus parsing.
- **Nodes**: SourceFile, Function, Method, Class, Interface, Import, Task, Milestone, Evidence, Claim
- **Edges**: CONTAINS, CALLS, RESOLVES_TO, IMPORTS, PART_OF, DEPENDS_ON, BLOCKS, SUPPORTED_BY
- **Rule**: Never deleted by enrichment. Only modified by reparsing.

## Layer 2: Cached Derived (Enrichment Outputs)
Edges and properties computed by enrichment scripts. All tagged `{derived: true}`.
- **Edges**: ANALYZED, ANCHORED_TO, FROM_PROJECT, SPANS_PROJECT, CO_CHANGES_WITH, POSSIBLE_CALL
- **Properties**: compositeRisk, riskTier, riskFlags, commitCountRaw, churnRelative, temporalCoupling
- **Rule**: Can be deleted and rebuilt with `npm run rebuild-derived`. Idempotent (MERGE-based).

## Layer 3: Query-Time (Ephemeral)
Computed during MCP tool calls or agent queries. Never persisted.
- **Examples**: Path traversals, risk aggregation, what-if simulations
- **Rule**: Session-scoped. Dies when the query completes.

## Operational Boundary
- `npm run rebuild-derived` deletes Layer 2, re-runs enrichment, leaves Layer 1 untouched.
- `npm run graph:metrics` records a GraphMetricsSnapshot node with edge/node counts and derived edge ratio.
- Cardinality monitoring: derived edge count should grow proportionally to canonical edges.
  If CO_CHANGES_WITH grows faster than CALLS, temporal coupling enrichment may be over-generating.
