#!/bin/bash
# Run ALL post-ingest enrichment passes after parse-and-ingest.ts
# Usage: cd codegraph && bash post-ingest-all.sh
# 
# Set STRUCTURAL_ONLY=true to skip embeddings (no OpenAI API key needed).
# Everything except search_codebase and NL→Cypher works without embeddings.
set -e
cd "$(dirname "$0")"

echo "=== 1/10: Risk scoring + edge classification ==="
python3 post-ingest-enrich.py

echo ""
echo "=== 2/10: State edges (READS_STATE/WRITES_STATE) ==="
npx tsx create-state-edges.ts 2>&1 | grep -v "dotenv\|tip:"

echo ""
echo "=== 3/10: Git change frequency ==="
npx tsx seed-git-frequency.ts 2>&1 | grep -v "dotenv\|tip:"

echo ""
echo "=== 4/10: POSSIBLE_CALL edges (dynamic dispatch) ==="
npx tsx create-possible-call-edges.ts 2>&1 | grep -v "dotenv\|tip:"

echo ""
echo "=== 5/10: Virtual dispatch (interface/inheritance) ==="
npx tsx create-virtual-dispatch-edges.ts 2>&1 | grep -v "dotenv\|tip:"

echo ""
echo "=== 6/10: Registration properties (registrationKind/Trigger) ==="
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
echo "=== 7/10: Project node ==="
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
echo "=== 8/10: Author ownership (git blame) ==="
npx tsx seed-author-ownership.ts godspeed 2>&1 | grep -v "dotenv\|tip:"

echo ""
echo "=== 9/10: Architecture layers ==="
npx tsx seed-architecture-layers.ts godspeed 2>&1 | grep -v "dotenv\|tip:"

echo ""
echo "=== 10/10: Embeddings (OpenAI) ==="
npx tsx embed-nodes.ts 2>&1 | grep -v "dotenv\|tip:"

echo ""
echo "✅ All post-ingest passes complete!"
