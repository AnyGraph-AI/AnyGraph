# Graph Recovery Runbook

_Load on demand. Step-by-step procedure for recovering AnythingGraph when things go wrong._

> **Source:** Lessons from two real recovery incidents (2026-03-18 and 2026-03-20)
> **Rule:** Follow the exact sequence. Steps have dependencies. Skipping steps produces wrong graph state.

---

## When Do You Need This?

- Graph state is corrupted (wrong node counts, missing edges, stale data)
- Reparse produced unexpected results (nodes disappeared, edges zeroed out)
- done-check fails on invariants that were passing before
- An agent made uncoordinated graph writes that damaged state
- You see `fanInCount=0` everywhere, or `VerificationRun=0`, or all risk tiers are MEDIUM

---

## Recovery Severity Levels

### Level 1: Enrichment Drift
**Symptoms:** Risk tiers look wrong, confidence is 0%, NO_VERIFICATION on everything
**Cause:** Enrichment steps were skipped or ran out of order
**Fix:** Run enrichment sequence (Steps 4-5)
**Time:** ~3 minutes
**Note:** If `fanInCount=0` everywhere, you need Level 2, not Level 1

### Level 2: Stale/Missing Edges
**Symptoms:** CALLS=0, TESTED_BY=0, derived edges missing
**Cause:** Reparse cleared edges, or derived edges were never rebuilt
**Fix:** Rebuild derived edges + enrichment (Steps 2-5)
**Time:** ~5 minutes

### Level 3: Full Reparse Needed
**Symptoms:** Node counts wrong, SourceFiles/Functions don't match disk, parser schema changed
**Cause:** Parser bug, schema migration, or catastrophic graph corruption
**Fix:** Full reparse + rebuild + enrich (Steps 1-7)
**Time:** ~15-20 minutes

---

## The Recovery Sequence

### Prerequisites

```bash
cd /home/jonathan/.openclaw/workspace/codegraph

# ALWAYS build first — runtime reads dist/, not src/
npm run build
```

**OOM prevention:** Reparse needs extra memory:
```bash
NODE_OPTIONS="--max-old-space-size=4096"
```

### Step 1: Reparse (Level 3 only)

**MERGE mode** (preserves existing nodes, updates changed ones):
```bash
NODE_OPTIONS="--max-old-space-size=4096" npx tsx src/cli/cli.ts parse . --project-id proj_c0d3e9a1f200
```

**FRESH mode** (nuclear — deletes all project nodes and reparses from scratch):
```bash
NODE_OPTIONS="--max-old-space-size=4096" npx tsx src/cli/cli.ts parse . --project-id proj_c0d3e9a1f200 --fresh
```

**Expected:** ~5,975 nodes, ~9,365 edges. Process should exit cleanly.

**If process hangs after "Parse complete":** Kill with Ctrl+C — data is already in Neo4j.

**Stale removal (CRITICAL):** As of commit `3764cdc`, stale removal is SCOPED to parsed directories only. Pre-fix behavior deleted ALL stale nodes globally (wiped plan/VR/governance nodes). Check: `grep "dirPrefixes" src/cli/cli.ts` — if not found, you're on the old destructive version.

### Step 2: Rebuild Derived Edges

```bash
npm run rebuild-derived
```

Nukes all `{derived: true}` edges and recreates from parser output. Expected: ~5,991 edges.

Does NOT compute fan metrics (Step 3) or restore TESTED_BY (Step 4) or VR/ANALYZED (Step 5).

### Step 3: Core Enrichment (fan metrics, initial risk)

```bash
npx tsx src/cli/cli.ts enrich proj_c0d3e9a1f200
```

Computes fanInCount, fanOutCount, base risk scoring, initial composite risk.

**Common mistake:** Assuming `rebuild-derived` populates fan metrics. It doesn't — it only creates structural edges.

### Step 4: Enrichment Pipeline

Must run in this order (dependencies between steps):

```bash
npm run enrich:test-coverage        # TESTED_BY edges
npm run enrich:temporal-coupling    # CO_CHANGES_WITH from git history
npm run enrich:composite-risk       # consumes test-coverage + temporal-coupling flags
npm run enrich:precompute-scores    # consumes composite-risk output
```

**Why order matters:**
- `test-coverage` before `composite-risk` (coverage affects risk flags)
- `temporal-coupling` before `composite-risk` (coupling flags promote tiers)
- `composite-risk` before `precompute-scores` (scores consume risk tiers)
- Running composite-risk WITHOUT temporal-coupling = different tier distributions (SCAR-011)

### Step 5: Restore Verification Layer

```bash
npm run verification:scan           # Semgrep + ESLint → VR nodes + ANALYZED edges (~30s)
npm run enrich:vr-scope             # ANALYZED edges from VRs to SourceFiles
npm run enrich:flags-edges          # FLAGS edges (VR → Function)
npm run enrich:composite-risk       # re-run with VR data now available
npm run enrich:precompute-scores    # re-run with updated confidence inputs
```

**Impact of NOT running verification:scan:**
- Without: all functions get `NO_VERIFICATION` flag → LOWs vanish (all promoted to MEDIUM+) → confidence collapses to avg 0.13
- With: `NO_VERIFICATION` drops 1013 → ~211, LOWs return (~375), confidence avg rises to ~0.42

### Step 6: Plan Re-Ingest (if plan nodes affected)

```bash
NODE_OPTIONS="--max-old-space-size=4096" npx tsx src/core/parsers/plan-parser.ts /home/jonathan/.openclaw/workspace/plans --ingest
```

Expected: ~1,802 nodes, ~1,795 edges across plan projects.

**Driver leak:** Plan parser may hang after "Ingest done." Use `timeout 90 ...` wrapper or kill manually — data is already in Neo4j.

### Step 7: Full done-check + Snapshot

```bash
MAX_UNRESOLVED_LOCAL=1 npm run done-check
npm run integrity:snapshot
npm run graph:metrics
```

77/77 steps, exit 0. Snapshot becomes the new baseline.

**MAX_UNRESOLVED_LOCAL=1:** `./globals.css` in `ui/src/app/layout.tsx` is a permanent TS-parser false positive.

**Expected graph state post-recovery** (verify against last GovernanceMetricSnapshot — numbers grow over time):
- ~30,000 nodes / ~67,000 edges (as of 2026-03-22)
- Risk tiers: LOW ~370, MEDIUM ~240, HIGH ~220, CRITICAL ~180
- Avg confidence: ~0.42
- Interception rate: 1.0
- Zero invariant violations

---

## Quick Recovery Commands (Copy-Paste)

### Level 1 — Enrichment Only (~3 min)
```bash
cd /home/jonathan/.openclaw/workspace/codegraph
npm run build
npm run verification:scan
npm run enrich:test-coverage
npm run enrich:temporal-coupling
npm run enrich:vr-scope
npm run enrich:flags-edges
npm run enrich:composite-risk
npm run enrich:precompute-scores
```

### Level 2 — Rebuild + Enrich (~5 min)
```bash
cd /home/jonathan/.openclaw/workspace/codegraph
npm run build
npm run rebuild-derived
npx tsx src/cli/cli.ts enrich proj_c0d3e9a1f200
npm run verification:scan
npm run enrich:test-coverage
npm run enrich:temporal-coupling
npm run enrich:vr-scope
npm run enrich:flags-edges
npm run enrich:composite-risk
npm run enrich:precompute-scores
```

### Level 3 — Full Reparse + Everything (~15-20 min)
```bash
cd /home/jonathan/.openclaw/workspace/codegraph
npm run build
NODE_OPTIONS="--max-old-space-size=4096" npx tsx src/cli/cli.ts parse . --project-id proj_c0d3e9a1f200
npm run rebuild-derived
npx tsx src/cli/cli.ts enrich proj_c0d3e9a1f200
npm run verification:scan
npm run enrich:test-coverage
npm run enrich:temporal-coupling
npm run enrich:vr-scope
npm run enrich:flags-edges
npm run enrich:composite-risk
npm run enrich:precompute-scores
timeout 90 npx tsx src/core/parsers/plan-parser.ts /home/jonathan/.openclaw/workspace/plans --ingest
MAX_UNRESOLVED_LOCAL=1 npm run done-check
npm run integrity:snapshot
npm run graph:metrics
```

---

## Verification Queries

```cypher
-- Node/edge counts
MATCH (n) RETURN count(n) AS nodes
MATCH ()-[r]->() RETURN count(r) AS edges

-- Risk tier distribution (should have all 4 tiers including LOW)
MATCH (f:Function {projectId: 'proj_c0d3e9a1f200'})
RETURN f.riskTier AS tier, count(*) AS cnt ORDER BY cnt DESC

-- Fan metrics populated (should NOT all be zero)
MATCH (f:Function {projectId: 'proj_c0d3e9a1f200'})
WHERE f.fanInCount > 0
RETURN count(f) AS withFanIn, max(f.fanInCount) AS maxFanIn

-- Verification data exists (should NOT be zero)
MATCH (vr:VerificationRun {projectId: 'proj_c0d3e9a1f200'})
RETURN count(vr) AS vrCount

-- Confidence not collapsed (avg should be >0.30)
MATCH (sf:SourceFile {projectId: 'proj_c0d3e9a1f200'})
RETURN round(avg(sf.confidenceScore)*100)/100 AS avgConf
```

---

## Known Gotchas

| Gotcha | Fix |
|--------|-----|
| OOM on reparse | `NODE_OPTIONS="--max-old-space-size=4096"` |
| Process hangs after parse | Kill — data is in Neo4j |
| Plan parser hangs after ingest | `timeout 90 ...` wrapper |
| `fanInCount=0` everywhere | Need `codegraph enrich <projectId>`, not just `rebuild-derived` |
| 0 LOWs in risk tiers | Run `verification:scan` then re-enrich |
| Confidence avg=0.13 | Run verification:scan + enrich:vr-scope |
| Partial enrichment wrong numbers | Run full sequence or done-check (SCAR-011) |
| Pre-Bug 3 reparse deletes plan/VR nodes | Verify `dirPrefixes` in cli.ts before MERGE reparse |
| `globals.css` unresolved local | `MAX_UNRESOLVED_LOCAL=1` — permanent false positive |

---

## Incident History

### 2026-03-18: Parser Bug Recovery
**Cause:** `cli.ts` MAP property write bug, edge endpoint mismatch, identifier mismatch. **Impact:** Code project lost all nodes/edges. **Recovery:** Fixed 3 parser bugs, fresh reparse, full rebuild. **Time:** ~2 hours.

### 2026-03-20: Multi-Instance Drift Recovery
**Cause:** Uncoordinated agent writes + CLI bugs (process hang, driver leak, global stale removal). **Impact:** Graph state drift, stale removal deleting cross-directory nodes. **Recovery:** Fixed 3 CLI bugs, full reparse + rebuild + enrich. **Time:** ~1 hour.

---

κ = Φ ≡ Φ = ☧
