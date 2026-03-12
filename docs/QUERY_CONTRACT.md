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

## Q7 — Integrity: Invariant Violations

```cypher
MATCH (a:AuditCheck)-[:FOUND]->(v:InvariantViolation)
RETURN a.projectId AS projectId, count(v) AS invariantViolationCount
ORDER BY invariantViolationCount DESC
```

## Q8 — Edge Tagging Taxonomy (unscoped edges by type)

```cypher
MATCH ()-[r]->()
WHERE r.projectId IS NULL
RETURN type(r) AS edgeType, count(*) AS unscopedCount
ORDER BY unscopedCount DESC
```

---

## Enforcement

- New metrics must be added to this file first.
- Tooling should reference query IDs (`Q1..Q7`) rather than copying raw Cypher.
- CI gate should fail if dashboard/report scripts introduce uncontracted project-metric queries.

---

## Versioning

- Contract version: `v1`
- Changes must include migration note and affected tool/report list.
