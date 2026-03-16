#!/bin/bash
# LEGACY: Run ALL post-ingest enrichment passes after parse-and-ingest.ts
# 
# PREFER: npm run done-check (55-step governance pipeline that includes enrichment)
# 
# This script predates the npm enrichment scripts (enrich:*) and done-check pipeline.
# It still works but paths assume running from the repo root.
#
# Usage: cd codegraph && bash scripts/post-ingest-all.sh
# Set STRUCTURAL_ONLY=true to skip embeddings (no OpenAI API key needed).
set -e
cd "$(dirname "$0")/.."

echo "=== 1/17: Risk scoring + edge classification ==="
python3 post-ingest-enrich.py

echo ""
echo "=== 2/17: State edges (READS_STATE/WRITES_STATE) ==="
npx tsx src/scripts/enrichment/create-state-edges.ts 2>&1 | grep -v "dotenv\|tip:"

echo ""
echo "=== 3/17: Git change frequency ==="
npx tsx src/scripts/enrichment/seed-git-frequency.ts 2>&1 | grep -v "dotenv\|tip:"

echo ""
echo "=== 4/17: Temporal coupling (git co-change mining) ==="
npx tsx src/scripts/enrichment/temporal-coupling.ts godspeed 2>&1 | grep -v "dotenv\|tip:"

echo ""
echo "=== 5/17: POSSIBLE_CALL edges (dynamic dispatch) ==="
npx tsx src/scripts/enrichment/create-possible-call-edges.ts 2>&1 | grep -v "dotenv\|tip:"

echo ""
echo "=== 6/17: Virtual dispatch (interface/inheritance) ==="
npx tsx src/scripts/enrichment/create-virtual-dispatch-edges.ts 2>&1 | grep -v "dotenv\|tip:"

echo ""
echo "=== 7/17: Registration properties (registrationKind/Trigger) ==="
cypher-shell -u neo4j -p codegraph "
MATCH (e:Entrypoint)
WHERE e.context IS NOT NULL
WITH e, apoc.convert.fromJsonMap(e.context) AS ctx
SET e.registrationKind = ctx.entrypointKind,
    e.registrationTrigger = ctx.trigger,
    e.framework = ctx.framework
WITH count(e) AS entrypoints
MATCH (h)-[:REGISTERED_BY]->(e2:Entrypoint)
WHERE e2.registrationKind IS NOT NULL
SET h.registrationKind = e2.registrationKind,
    h.registrationTrigger = e2.registrationTrigger
RETURN 'Promoted registrationKind/Trigger to ' + toString(count(h)) + ' handlers' AS status
"

echo ""
echo "=== 8/17: Project node ==="
cypher-shell -u neo4j -p codegraph "
MERGE (p:Project {projectId: 'proj_60d5feed0001'})
SET p.name = 'GodSpeed',
    p.path = '/mnt/c/Users/ddfff/Downloads/Bots/GodSpeed/',
    p.status = 'complete',
    p.updatedAt = datetime()
WITH p
OPTIONAL MATCH (n:CodeNode {projectId: 'proj_60d5feed0001'})
WITH p, count(n) AS nodes
OPTIONAL MATCH ()-[r]->()
WITH p, nodes, count(r) AS edges
SET p.nodeCount = nodes, p.edgeCount = edges
RETURN 'Project node updated: ' + toString(nodes) + ' nodes, ' + toString(edges) + ' edges' AS status
"

echo ""
echo "=== 9/17: Author ownership (git blame) ==="
npx tsx src/scripts/enrichment/seed-author-ownership.ts godspeed 2>&1 | grep -v "dotenv\|tip:"

echo ""
echo "=== 10/17: Architecture layers ==="
npx tsx src/scripts/enrichment/seed-architecture-layers.ts godspeed 2>&1 | grep -v "dotenv\|tip:"

echo ""
echo "=== 11/17: riskLevel v2 promotion (temporal coupling + author entropy) ==="
cypher-shell -u neo4j -p codegraph "
MATCH (f:CodeNode)
WHERE f.riskLevel IS NOT NULL
WITH f,
  coalesce(f.temporalCoupling, 0) AS tc,
  coalesce(f.authorEntropy, 1) AS ae,
  f.riskLevel AS base
SET f.riskLevel = base * (1.0 + tc * 0.1) * (1.0 + (ae - 1) * 0.15),
    f.riskTier = CASE
      WHEN base * (1.0 + tc * 0.1) * (1.0 + (ae - 1) * 0.15) > 500 THEN 'CRITICAL'
      WHEN base * (1.0 + tc * 0.1) * (1.0 + (ae - 1) * 0.15) > 100 THEN 'HIGH'
      WHEN base * (1.0 + tc * 0.1) * (1.0 + (ae - 1) * 0.15) > 20 THEN 'MEDIUM'
      ELSE 'LOW'
    END
RETURN 'Promoted riskLevel v2 on ' + toString(count(f)) + ' nodes' AS status
"

echo ""
echo "=== 12/17: Provenance + confidence on edges ==="
npx tsx src/scripts/enrichment/add-provenance.ts 2>&1 | grep -v "dotenv\|tip:"

echo ""
echo "=== 13/17: Unresolved reference nodes ==="
npx tsx src/scripts/enrichment/create-unresolved-nodes.ts 2>&1 | grep -v "dotenv\|tip:"

echo ""
echo "=== 14/17: Audit subgraph (invariant checks) ==="
npx tsx src/scripts/verify/run-audit.ts 2>&1 | grep -v "dotenv\|tip:"

echo ""
echo "=== 15/17: Test coverage mapping ==="
npx tsx src/scripts/enrichment/seed-test-coverage.ts . 2>&1 | grep -v "dotenv\|tip:"

echo ""
echo "=== 16/17: Embeddings (OpenAI — set STRUCTURAL_ONLY=true to skip) ==="
npx tsx src/scripts/enrichment/embed-nodes.ts 2>&1 | grep -v "dotenv\|tip:"

echo ""
echo "=== 17/17: Evaluation (regression detection) ==="
npx tsx src/scripts/verify/run-evaluation.ts 2>&1 | grep -v "dotenv\|tip:"

echo ""
echo "✅ All post-ingest passes complete!"
