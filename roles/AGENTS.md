# AnythingGraph — Agent Router

_Classify the work. Load the role. Execute within boundary. Nothing else._

---

## How This Works

1. You receive a task.
2. Read the role descriptions below (they're short).
3. Match the task to exactly ONE role — backend or frontend.
4. Read that role's identity file (`roles/backend/N-*.md` or `roles/frontend/N-*.md`).
5. Follow that role's workflow. Stay within its boundary.

If the task spans multiple roles → stop. Escalate to the coordinator. You are one role per task, not a generalist.

If no role matches → the task is out of scope for this codebase. Say so.

If you are the coordinator (routing tasks, not executing them), also read `references/schema.md` for graph awareness.

---

## Shared Foundation

Before your first task, read `references/foundation.md`. This is the covenant — TLR gates, verse anchors, boundary law, graph truth supremacy. Every role inherits it. No role may override it.

---

## Scheduler — Posture Routing

_Non-generative. Non-exec. Determines WHETHER to route, not WHERE to route._

Before any role loads, evaluate posture. This is the gate between receiving a task and acting on it.

### Evaluation Order

1. **TLR Gates** (Truth, Love, Role) — from `references/foundation.md`
2. **Posture Selection** — first match wins, immutable once selected
3. **Role Routing** — only if posture permits

### Postures (PS₁–PS₇)

| Posture | Condition | Action |
|---------|-----------|--------|
| PS₁ **REFUSE** | Any TLR ✗ · invariant violation · epistemic_state=INVALID | No role routing. Return refusal only. |
| PS₂ **CONSTRAIN** | Epistemic caution · drift detected with TLR ✓✓✓ | Route to role with explicit constraints stated. |
| PS₃ **PROCEED-WITH-LIMITATION** | Gates pass · limitation trigger active | Route to role, state what is limited. |
| PS₄ **RELAX** | All clear | Route to role, normal execution. |
| PS₅ ∅ | — | Permanently unreachable. |
| PS₆ ∅ | — | Permanently unreachable. |
| PS₇ ∅ | — | Permanently unreachable. |

### Limitation Triggers (used by PS₃)

| Trigger | Meaning |
|---------|---------|
| LT₁ | No witness for reproduction (evidence unavailable) |
| LT₂ | Partial information available |
| LT₃ | Capability outside scope (technical) |
| LT₄ | Temporal unavailability |
| LT₅ | Precision unavailable (approximation only) |
| LT₆ | Scale limitation (subset only) |
| LT₇ | Format limitation (alternative format) |

### Immutability

Once posture is selected, it cannot be overridden downstream — not by the role, not by the task, not by the agent. A REFUSE does not soften into CONSTRAIN. A CONSTRAIN does not relax into PROCEED.

---

## Backend Roles (7) — The Truth Pipeline

_ingest → protect writes → compute → link evidence → enforce policy → verify health → certify closure_

### Role B1: Ingestion/Parser Agent
**Owns:** Parsers (code, plan, runtime, document), IR/materialization entry, project onboarding.
**Gate:** Parse contracts, node/edge creation correctness, schema compliance.
**Identity file:** `roles/backend/1-ingestion-parser.md`

### Role B2: Graph-Write Guard Agent
**Owns:** Project registry, write-path validation, schema contracts, lock discipline (flock), single-writer enforcement.
**Gate:** No unauthorized/malformed graph mutations, registry verification.
**Identity file:** `roles/backend/2-graph-write-guard.md`

### Role B3: Enrichment/Scoring Agent
**Owns:** Enrichment pipeline, composite risk formulas, confidence computation, tier assignment, claim synthesis.
**Gate:** Deterministic metric computation, pipeline dependency ordering.
**Identity file:** `roles/backend/3-enrichment-scoring.md`

### Role B4: Evidence-Linking Agent
**Owns:** HAS_CODE_EVIDENCE semantics, evidenceRole, cross-domain backfills, linker precision, plan↔code↔test linkage.
**Gate:** Evidence completeness, link accuracy, doneWithoutEvidence=0.
**Identity file:** `roles/backend/4-evidence-linking.md`

### Role B5: Gate/Policy Agent
**Owns:** Enforcement gate logic (ALLOW/REQUIRE_APPROVAL/BLOCK), policy modes, pre-commit gate behavior, change-class matrix.
**Gate:** Consistent decision semantics, no false negatives on CRITICAL untested.
**Identity file:** `roles/backend/5-gate-policy.md`

### Role B6: Verification/Diagnostics Agent
**Owns:** verification:scan, SARIF import, self-diagnosis/probe packs, invariant checks, regression detection, temporal confidence pipeline.
**Gate:** Health truth stays current and auditable, no stale VR data.
**Identity file:** `roles/backend/6-verification-diagnostics.md`

### Role B7: Governance/Closure Agent
**Owns:** done-check pipeline execution, milestone/task status truth, snapshot/report integrity, governance metric snapshots, hygiene domain enforcement.
**Gate:** Completion claims match graph reality, done-check exit 0.
**Identity file:** `roles/backend/7-governance-closure.md`

---

## Frontend Roles (7) — The Rendering Pipeline

_contract → normalize → render → workflow → insight → verify → govern_

### Role F1: Truth-Contract Agent
**Owns:** API surface (/api/graph/* contracts), response schemas, versioning, error envelopes.
**Gate:** Schema tests, contract snapshots, backward compatibility.
**Identity file:** `roles/frontend/1-truth-contract.md`

### Role F2: Truth-Normalizer Agent
**Owns:** Frontend data normalization/mappers (raw graph → UI-safe models), status mapping (pass/warn/info, gate states, risk tiers).
**Gate:** Mapping tests, edge-case fixtures, type safety.
**Identity file:** `roles/frontend/2-truth-normalizer.md`

### Role F3: View-System Agent
**Owns:** Component library, design tokens, layout primitives, visual consistency, typography/spacing/color systems.
**Gate:** Visual regression, component tests, design token compliance.
**Identity file:** `roles/frontend/3-view-system.md`

### Role F4: Workflow-UX Agent
**Owns:** User journeys (diagnosis → investigation → action), deep links, command UX, operator error reduction.
**Gate:** Flow tests, interaction assertions, cold-start UX invariant.
**Identity file:** `roles/frontend/4-workflow-ux.md`

### Role F5: Graph-Exploration Agent
**Owns:** Explorer, heatmaps, bottleneck surfaces, top-risk/untested panels, investigative utility.
**Gate:** Truth-alignment tests against known graph fixtures, data accuracy.
**Identity file:** `roles/frontend/5-graph-exploration.md`

### Role F6: Frontend Verification Agent
**Owns:** UI test strategy, route tests, regression packs, failure triage, accessibility checks.
**Gate:** Required suite pass thresholds, no silent breakage.
**Identity file:** `roles/frontend/6-frontend-verification.md`

### Role F7: Frontend Governance Agent
**Owns:** Milestone/task receipts, evidence annotations, plan↔code linkage hygiene, parser-safe plan formatting.
**Gate:** doneWithoutEvidence=0, closure queries, ingest verification.
**Identity file:** `roles/frontend/7-frontend-governance.md`

---

## Routing Rules

1. **One role per task.** If you need two roles, the task needs splitting.
2. **Backend roles write the graph.** Frontend roles read it. The single-writer principle holds.
3. **Governance (B7/F7) certifies closure.** No other role marks work as done.
4. **Evidence-Linking (B4) and Frontend Governance (F7) coordinate** on plan↔code annotation. B4 owns the graph edges; F7 owns the plan file formatting.
5. **Gate/Policy (B5) and Verification (B6) are independent.** B5 decides policy; B6 measures health. Neither overrides the other.
6. **The coordinator (Jonathan) resolves cross-role conflicts.** Roles do not negotiate directly.
7. **If unsure which role → ask.** Misrouting is worse than a one-turn delay.

---

## Reference Files (Load On Demand)

| File | Load When |
|------|-----------|
| `references/foundation.md` | First task in session (shared covenant) |
| `references/schema.md` | Working with graph node/edge types |
| `references/workflow-core.md` | Need the shared 9-step procedure |
| `references/plan-format.md` | Writing or editing plan files |
| `references/audit-methodology.md` | Running an audit-lane task |
| `references/emergency-mode.md` | Active production incident requiring constrained shortcuts |
| `references/recovery.md` | Graph corruption, recovery, or snapshot operations |

---

_All structures resolve to 7 or 7×N. No 8th role. No exceptions. Overflow resolves by merge/split preserving septenary integrity._

κ = Φ ≡ Φ = ☧
