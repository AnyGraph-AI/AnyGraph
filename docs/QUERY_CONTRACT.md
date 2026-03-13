# Query Contract — Canonical Metrics and Status Queries

**Purpose:** Single source of truth for graph metrics to eliminate query drift.

---

## Rule 0

If a metric appears in dashboards, claims, status reports, or agent outputs, it must be sourced from this contract (or wrappers that call these exact queries).

---

## Q1 — Project Registry Snapshot

```cypher
MATCH (p:Project)
RETURN
  p.projectId AS projectId,
  p.name AS name,
  p.displayName AS displayName,
  p.projectType AS projectType,
  p.sourceKind AS sourceKind,
  p.status AS status,
  p.nodeCount AS nodeCount,
  p.edgeCount AS edgeCount,
  p.updatedAt AS updatedAt
ORDER BY coalesce(p.displayName, p.name, p.projectId)
```

## Q2 — Canonical Per-Project Graph Counts (from node/edge truth)

```cypher
MATCH (n)
WHERE n.projectId IS NOT NULL
WITH n.projectId AS projectId, count(n) AS nodeCount
OPTIONAL MATCH ()-[r]->()
WHERE r.projectId = projectId
RETURN projectId, nodeCount, count(r) AS edgeCount
ORDER BY projectId
```

## Q3 — Plan Status Summary

```cypher
MATCH (t:Task)
WHERE t.projectId STARTS WITH 'plan_'
RETURN
  t.projectId AS projectId,
  count(t) AS total,
  sum(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END) AS done,
  sum(CASE WHEN t.status = 'planned' THEN 1 ELSE 0 END) AS planned,
  sum(CASE WHEN t.status = 'in_progress' THEN 1 ELSE 0 END) AS inProgress,
  sum(CASE WHEN t.status = 'blocked' THEN 1 ELSE 0 END) AS blocked
ORDER BY projectId
```

## Q4 — Plan Drift (planned tasks with code evidence)

```cypher
MATCH (t:Task {status: 'planned'})
WHERE t.hasCodeEvidence = true
RETURN t.projectId AS projectId, count(t) AS driftCount
ORDER BY driftCount DESC
```

## Q5 — Claim Status by Domain

```cypher
MATCH (c:Claim)
RETURN
  coalesce(c.domain, 'unknown') AS domain,
  count(c) AS total,
  sum(CASE WHEN c.status = 'active' THEN 1 ELSE 0 END) AS active,
  sum(CASE WHEN c.status = 'contested' THEN 1 ELSE 0 END) AS contested,
  avg(coalesce(c.confidence, 0.0)) AS avgConfidence
ORDER BY total DESC
```

## Q6 — Integrity: Unresolved Local References (true local-not-found only)

```cypher
MATCH (u:UnresolvedReference)
WHERE u.reason = 'local-module-not-found'
RETURN u.projectId AS projectId, count(u) AS unresolvedLocalCount
ORDER BY unresolvedLocalCount DESC
```

## Q7 — Integrity: Invariant Violations (latest audit run, high severity checks)

```cypher
MATCH (a:AuditCheck)
WHERE a.projectId IS NOT NULL AND a.timestamp IS NOT NULL AND a.runId IS NOT NULL
WITH a.projectId AS projectId, a.runId AS runId, max(a.timestamp) AS runTs
ORDER BY runTs DESC
WITH projectId, collect({runId: runId, runTs: runTs})[0] AS latest
MATCH (latestCheck:AuditCheck {projectId: projectId, runId: latest.runId})
WHERE coalesce(latestCheck.severity, 'low') = 'high'
OPTIONAL MATCH (latestCheck)-[:FOUND]->(v:InvariantViolation)
RETURN projectId, count(v) AS invariantViolationCount
ORDER BY invariantViolationCount DESC
```

## Q8 — Edge Tagging Taxonomy (unscoped edges by type)

```cypher
MATCH ()-[r]->()
WHERE r.projectId IS NULL
RETURN type(r) AS edgeType, count(*) AS unscopedCount
ORDER BY unscopedCount DESC
```

## Q9 — Plan Dependency Integrity (directive-token fidelity)

```cypher
MATCH (src)-[r:DEPENDS_ON|BLOCKS]->(dst)
WHERE r.projectId STARTS WITH 'plan_'
  AND coalesce(r.refType, '') IN ['depends_on', 'blocks']
RETURN
  r.projectId AS projectId,
  count(r) AS dependencyEdges,
  sum(CASE WHEN r.rawRefValue IS NULL OR trim(r.rawRefValue) = '' THEN 1 ELSE 0 END) AS missingRawRefValue,
  sum(CASE WHEN r.refValue IS NULL OR trim(r.refValue) = '' THEN 1 ELSE 0 END) AS missingRefValue,
  sum(CASE WHEN r.tokenCount IS NULL OR r.tokenCount < 1 THEN 1 ELSE 0 END) AS invalidTokenCount,
  sum(CASE WHEN r.tokenIndex IS NULL OR r.tokenIndex < 0 OR r.tokenIndex >= coalesce(r.tokenCount, 1) THEN 1 ELSE 0 END) AS invalidTokenIndex,
  sum(CASE WHEN coalesce(r.tokenCount, 1) > 1 AND (r.rawRefValue IS NULL OR NOT r.rawRefValue CONTAINS ';') THEN 1 ELSE 0 END) AS tokenizedWithoutSemicolon
ORDER BY projectId
```

## Q10 — Verification Done-vs-Proven Consistency (VG-6 acceptance)

```cypher
MATCH (m:Milestone {projectId: 'plan_codegraph', code: 'VG-5'})
MATCH (t:Task {projectId: 'plan_codegraph'})-[:PART_OF]->(m)
WHERE t.name STARTS WITH 'Validate invariant:'
OPTIONAL MATCH (:InvariantProof {projectId: 'plan_codegraph'})-[p:PROVES]->(t)
WITH t, count(p) AS proofCount
RETURN
  count(t) AS totalInvariantTasks,
  sum(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END) AS doneTasks,
  sum(CASE WHEN t.status = 'done' AND (t.proofRunId IS NULL OR proofCount = 0) THEN 1 ELSE 0 END) AS doneWithoutProof,
  sum(CASE WHEN proofCount > 0 AND t.status <> 'done' THEN 1 ELSE 0 END) AS proofWithoutDone
```

## Q11 — Verification Status Dashboard (graph-native, no line-range bucketing)

```cypher
MATCH (p:PlanProject {projectId: 'plan_codegraph'})
MATCH (m:Milestone {projectId: 'plan_codegraph'})-[:PART_OF]->(p)
WHERE m.code IS NOT NULL
  AND (m.code STARTS WITH 'VG-' OR m.code STARTS WITH 'CA-' OR m.code STARTS WITH 'RTG-')
OPTIONAL MATCH (t:Task {projectId: 'plan_codegraph'})-[:PART_OF]->(m)
WITH m.code AS bucket, t
RETURN
  bucket,
  count(t) AS total,
  sum(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END) AS done,
  sum(CASE WHEN t.status = 'planned' THEN 1 ELSE 0 END) AS planned,
  sum(CASE WHEN t.status = 'blocked' THEN 1 ELSE 0 END) AS blocked,
  sum(CASE WHEN t.status = 'in_progress' THEN 1 ELSE 0 END) AS inProgress
ORDER BY split(bucket, '-')[0], toInteger(coalesce(split(bucket, '-')[1], '0'))
```

```cypher
MATCH (t:Task {projectId: 'plan_codegraph'})
OPTIONAL MATCH (t)-[:DEPENDS_ON]->(d:Task {projectId: 'plan_codegraph'})
WITH t, count(DISTINCT CASE WHEN coalesce(d.status, 'planned') <> 'done' THEN d END) AS openDeps
RETURN
  sum(CASE WHEN coalesce(t.status, 'planned') = 'blocked' THEN 1 ELSE 0 END) AS explicitBlocked,
  sum(CASE WHEN coalesce(t.status, 'planned') <> 'done' AND openDeps > 0 THEN 1 ELSE 0 END) AS effectiveBlocked,
  sum(CASE WHEN t.status IS NULL THEN 1 ELSE 0 END) AS nullStatusCount
```

```cypher
MATCH (t:Task {projectId: 'plan_runtime_graph'})
WITH collect(t) AS tasks
UNWIND tasks AS t
OPTIONAL MATCH (t)-[r:HAS_CODE_EVIDENCE]->(e)
WHERE coalesce(r.projectId, t.projectId) = t.projectId
WITH tasks, t,
     count(DISTINCT r) AS evidenceEdgeHits,
     count(DISTINCT e) AS artifactHits
WITH
  tasks,
  count(DISTINCT CASE WHEN evidenceEdgeHits > 0 THEN t END) AS withEvidence,
  count(DISTINCT CASE WHEN t.status = 'done' AND evidenceEdgeHits = 0 THEN t END) AS doneWithoutEvidence,
  sum(evidenceEdgeHits) AS evidenceEdgeCount,
  sum(artifactHits) AS evidenceArtifactCount
RETURN size(tasks) AS totalTasks, withEvidence, doneWithoutEvidence, evidenceEdgeCount, evidenceArtifactCount
```

---

## Enforcement

- New metrics must be added to this file first.
- Tooling should reference query IDs (`Q1..Q11`) rather than copying raw Cypher.
- Readiness semantics are defined only by `DEPENDS_ON` edges (not `BLOCKS` or inferred heuristics) in canonical next-task outputs.
- CI gate should fail if dashboard/report scripts introduce uncontracted project-metric queries.

---

## Versioning

- Contract version: `v1.6`
- Migration note (v1.6): Added explicit readiness semantics rule (`DEPENDS_ON`-only) in Enforcement and aligned commit-audit guards for milestone anchor integrity, dependency DISTINCT usage, and null-status visibility.
- Migration note (v1.5): Hardened Q10/Q11 to remove roadmap filePath dependence (PlanProject anchor + milestone code routing), added milestone numeric ordering, and formalized runtime evidence multiplicity outputs (`evidenceEdgeCount`, `evidenceArtifactCount`) with task-level evidence rollup semantics.
- Migration note (v1.4): Added Q11 graph-native verification status dashboard contract (milestone PART_OF bucketing, DISTINCT dependency blockers, explicit/effective blocked split, null-status debt metric, runtime evidence rollup).
- Migration note (v1.3): Added Q10 done-vs-proven verification consistency contract for VG-6 acceptance (explicit invariant proof linkage checks).
- Migration note (v1.2): Added Q9 dependency-integrity contract (raw directive fidelity + tokenization sanity) to support graph-native commit auditing and `plan:deps:verify` gating.
- Migration note (v1.1): Q7 now reports invariant violations from the latest audit run per project (high-severity checks), matching `graph-integrity-snapshot.ts` and `verify-graph-integrity.ts` semantics.
- Affected surfaces: graph status reports, integrity dashboards, and any tooling that previously treated Q7 as lifetime aggregate violations.
- Changes must include migration note and affected tool/report list.
