// Query Contract bindings from docs/QUERY_CONTRACT.md

export const CONTRACT_QUERY_Q11_MILESTONE_BUCKETS = `MATCH (p:PlanProject {projectId: $projectId})
MATCH (m:Milestone {projectId: $projectId})-[:PART_OF]->(p)
WHERE m.code IS NOT NULL
  AND (m.code STARTS WITH 'VG-' OR m.code STARTS WITH 'CA-' OR m.code STARTS WITH 'RTG-')
OPTIONAL MATCH (t:Task {projectId: $projectId})-[:PART_OF]->(m)
WITH m.code AS bucket, t
RETURN
  bucket,
  count(t) AS total,
  sum(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END) AS done,
  sum(CASE WHEN t.status = 'planned' THEN 1 ELSE 0 END) AS planned,
  sum(CASE WHEN t.status = 'blocked' THEN 1 ELSE 0 END) AS blocked,
  sum(CASE WHEN t.status = 'in_progress' THEN 1 ELSE 0 END) AS inProgress
ORDER BY split(bucket, '-')[0], toInteger(coalesce(split(bucket, '-')[1], '0'))`;

export const CONTRACT_QUERY_Q11_NEXT_TASKS = `MATCH (t:Task {projectId: $projectId})
WHERE coalesce(t.status, 'planned') <> 'done'
OPTIONAL MATCH (t)-[:DEPENDS_ON]->(d:Task {projectId: $projectId})
WITH t, count(DISTINCT CASE WHEN coalesce(d.status, 'planned') <> 'done' THEN d END) AS openDeps
WHERE coalesce(t.status, 'planned') <> 'blocked'
RETURN
  t.id AS id,
  t.line AS line,
  t.name AS task,
  coalesce(t.status, 'planned') AS status,
  openDeps
ORDER BY openDeps ASC, coalesce(t.line, 999999) ASC
LIMIT 10`;

export const CONTRACT_QUERY_Q11_BLOCKED = `MATCH (t:Task {projectId: $projectId})
OPTIONAL MATCH (t)-[:DEPENDS_ON]->(d:Task {projectId: $projectId})
WITH t, count(DISTINCT CASE WHEN coalesce(d.status, 'planned') <> 'done' THEN d END) AS openDeps
RETURN
  sum(CASE WHEN coalesce(t.status, 'planned') = 'blocked' THEN 1 ELSE 0 END) AS explicitBlocked,
  sum(CASE WHEN coalesce(t.status, 'planned') <> 'done' AND openDeps > 0 THEN 1 ELSE 0 END) AS effectiveBlocked,
  sum(CASE WHEN t.status IS NULL THEN 1 ELSE 0 END) AS nullStatusCount`;

export const CONTRACT_QUERY_Q11_RUNTIME_EVIDENCE = `MATCH (t:Task {projectId: $runtimeProjectId})
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
RETURN size(tasks) AS totalTasks, withEvidence, doneWithoutEvidence, evidenceEdgeCount, evidenceArtifactCount`;

export const CONTRACT_QUERY_Q14_PROJECT_COUNTS = `MATCH (n)
WHERE n.projectId IS NOT NULL
WITH n.projectId AS projectId, count(n) AS nodeCount
OPTIONAL MATCH ()-[r]->()
WHERE r.projectId = projectId
RETURN projectId, nodeCount, count(r) AS edgeCount
ORDER BY projectId`;

export const CONTRACT_QUERY_Q15_PROJECT_STATUS = `MATCH (p:Project)
WHERE p.projectId IS NOT NULL
RETURN
  p.projectId AS projectId,
  p.displayName AS displayName,
  p.projectType AS projectType,
  p.sourceKind AS sourceKind,
  p.status AS status,
  p.updatedAt AS updatedAt,
  p.nodeCount AS nodeCount,
  p.edgeCount AS edgeCount
ORDER BY p.projectId`;

export const CONTRACT_QUERY_Q16_PROJECT_DRIFT = `MATCH (s:IntegritySnapshot)
WITH s.projectId AS projectId,
     s.timestamp AS timestamp,
     s.nodeCount AS nodeCount,
     s.edgeCount AS edgeCount,
     s.unresolvedLocalCount AS unresolvedLocalCount,
     s.invariantViolationCount AS invariantViolationCount
ORDER BY projectId, timestamp DESC
WITH projectId, collect({
  timestamp: timestamp,
  nodeCount: nodeCount,
  edgeCount: edgeCount,
  unresolvedLocalCount: unresolvedLocalCount,
  invariantViolationCount: invariantViolationCount
}) AS snaps
RETURN
  projectId,
  snaps[0] AS latest,
  snaps[1] AS previous
ORDER BY projectId`;

export const CONTRACT_QUERY_Q17_CLAIM_STATUS = `MATCH (c:Claim)
RETURN
  coalesce(c.projectId, 'global') AS projectId,
  c.claimType AS claimType,
  c.status AS status,
  count(c) AS claimCount
ORDER BY projectId, claimType, status`;
