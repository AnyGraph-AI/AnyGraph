# Query Contract: Four-View Structural Separation

> RF-1 — Canonical view boundaries and allowed cross-view edges.

## Views

Every verification datum belongs to exactly one of four views:

| View | Purpose | Mutability | Owner |
|------|---------|-----------|-------|
| **ProvenanceView** | Where data came from | Append-only | Ingest pipeline |
| **EvidenceView** | What was observed | Write-once per observation | Verification tools |
| **TrustView** | How much to trust it | Recomputable | Trust computation engine |
| **DecisionView** | What to do about it | Mutable by decision actors | Adjudication / gates |

## View Field Ownership

Fields are assigned to exactly one view. The canonical mapping lives in
`VIEW_FIELD_REGISTRY` (`src/core/verification/verification-schema.ts`).

### ProvenanceView Fields
- `sourceKind`, `toolVersion`, `attestationRef`, `subjectDigest`
- `predicateType`, `verifierId`, `timeVerified`
- `runConfigHash`, `queryPackId`, `policyBundleId`, `externalContextSnapshotRef`

### EvidenceView Fields
- `status`, `criticality`, `evidenceGrade`, `freshnessTs`, `reproducible`
- `resultFingerprint`, `firstSeenTs`, `lastSeenTs`
- `baselineRef`, `mergeBase`

### TrustView Fields
- `baseEvidenceScore`, `effectiveConfidence`
- `sourceFamily`, `sourceFamilyCap`, `collusionFlag`
- `hardPenalty`, `timeConsistencyFactor`
- `confidenceVersion`, `confidenceInputsHash`, `lastRecomputeAt`, `recomputeReason`

### DecisionView Fields
- `lifecycleState`, `adjudicationState`, `adjudicationReason`, `adjudicationComment`
- `approvalMode`, `branchScope`, `decisionHash`
- `gateVerdict`, `requiresRevalidation`

## Cross-View Boundary Rules

```
                    ┌──────────────┐
                    │  Provenance  │ (append-only source of truth)
                    └──────┬───────┘
                           │ direct_read (all views can read)
              ┌────────────┼────────────┐
              ▼            ▼            ▼
       ┌──────────┐  ┌──────────┐  ┌──────────┐
       │ Evidence  │  │  Trust   │  │ Decision │
       └────┬─────┘  └────┬─────┘  └──────────┘
            │              │              ▲
            │ transform    │ transform    │
            └──────────────┴──────────────┘
```

### Allowed Data Flows

| From → To | Mechanism | Rationale |
|-----------|-----------|-----------|
| Provenance → Evidence | `direct_read` | Evidence needs to know where observations came from |
| Provenance → Trust | `direct_read` | Trust computation needs provenance metadata |
| Provenance → Decision | `direct_read` | Decisions reference provenance for audit trail |
| Evidence → Trust | `transform_function` | Trust scores are *computed from* evidence, not copied |
| Evidence → Decision | `transform_function` | Decisions are *derived from* evidence |
| Trust → Decision | `transform_function` | Gate verdicts are *computed from* trust scores |

### Prohibited Data Flows

| From → To | Rationale |
|-----------|-----------|
| Evidence → Provenance | Evidence must not alter provenance (append-only) |
| Trust → Provenance | Trust must not alter provenance (append-only) |
| Trust → Evidence | Trust must not alter evidence observations |
| Decision → Provenance | Decision must not alter provenance |
| Decision → Evidence | Decision must not alter evidence |
| Decision → Trust | Decision must not alter trust scores |

## Enforcement

### At Schema Level
- `VIEW_FIELD_REGISTRY` maps every field to its owning view
- `validateViewMutation(actingView, fieldNames)` returns violations
- `enforceMutationBoundary(actingView, fieldNames)` throws `ViewMutationError`

### At Runtime
- View-scoped update operations must declare their acting view
- Cross-view transforms must use `executeViewTransform()` with a named `ViewTransform`
- Transform functions are the ONLY mechanism for `Evidence → Trust → Decision` flow

### At Query Level
Queries that modify verification data should include a view assertion:

```cypher
// ✅ CORRECT: Trust computation updating TrustView fields only
MATCH (r:VerificationRun {id: $id})
SET r.effectiveConfidence = $score,
    r.confidenceVersion = r.confidenceVersion + 1,
    r.lastRecomputeAt = toString(datetime())
// All fields belong to TrustView ✓

// ❌ VIOLATION: Trust computation directly setting DecisionView fields
MATCH (r:VerificationRun {id: $id})
SET r.effectiveConfidence = $score,
    r.gateVerdict = 'pass'  // DecisionView field! Must go through transform
```

## Allowed Cross-View Edge Types

These Neo4j edge types are permitted to cross view boundaries:

| Edge | From View | To View | Purpose |
|------|-----------|---------|---------|
| `DERIVED_FROM_PROOF` | Decision | Evidence | Decision references its evidence basis |
| `DERIVED_FROM_RUN` | Decision | Evidence | Decision cites verification run |
| `DERIVED_FROM_GATE` | Decision | Decision | Decision chains |
| `SUPPORTED_BY` | Claim | Evidence | Claim cites supporting evidence |
| `CONTRADICTED_BY` | Claim | Evidence | Claim cites contradicting evidence |
| `MEASURED` | GovernanceMetricSnapshot | all | Metrics observe any view |
| `HAS_SCOPE` | Evidence | Evidence | Scope is evidence-internal |
| `ADJUDICATES` | Decision | Evidence | Adjudication targets evidence |
| `ILLUSTRATES` | Evidence | Evidence | Witness illustrates run |

## Invariants

1. **Provenance immutability**: Once a provenance field is set on a node, it may only be updated by appending a new provenance record (new node), never by overwriting.
2. **No confidence mutation across views**: A field classified as TrustView (`effectiveConfidence`, `baseEvidenceScore`, etc.) may not be SET by an operation acting in Evidence or Decision context.
3. **Transform audit trail**: Every cross-view transform must produce a log entry identifying: source view, target view, transform name, input hash, output hash.
4. **Field ownership stability**: A field's view assignment in `VIEW_FIELD_REGISTRY` may not change without a schema migration.
