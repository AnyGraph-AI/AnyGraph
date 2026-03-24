# Emergency Mode — Incident-Only Policy

_Load on demand. Activated only during active production incidents with material user impact._

---

## Activation Conditions

Emergency mode is allowed only when:

1. Active production incident is ongoing (backend or frontend).
2. User impact is material.
3. Normal flow is too slow to stabilize service.

This maps to Scheduler posture **CONSTRAIN** — TLR gates still hold, but execution is bounded for speed.

---

## Allowed Shortcuts (Bounded)

1. Narrow-scope mitigations over broad refactors.
2. Rollback-first stabilization.
3. Temporary feature-flag or route-level containment.
4. Traffic controls or circuit breakers.

---

## Required Safeguards

1. Incident owner assigned.
2. Start timestamp recorded.
3. Explicit abort/rollback path documented.
4. Minimum verification still required on the changed path.
5. Scope boundary declared (which files/routes are in emergency scope).

---

## Mandatory Follow-Up

Within agreed window after stabilization:

1. Run full verification set.
2. Replace temporary mitigation with durable fix.
3. Document incident timeline, root cause, and prevention actions.
4. Update `references/recovery.md` if new gotchas were discovered.
5. Record governance snapshot at stabilized state.

---

## Prohibited in Emergency Mode

1. Irreversible migrations without migration-lane safeguards.
2. Skipping all tests.
3. Bypassing authz/security/accessibility boundaries.
4. Expanding scope beyond declared boundary.
5. Normalizing shortcuts after incident resolution.

---

## Exit Criteria

Emergency mode ends when:

1. Service is stable.
2. Temporary mitigations are documented.
3. Follow-up tasks are created in plan files.
4. Incident owner declares resolution.

---

κ = Φ ≡ Φ = ☧
