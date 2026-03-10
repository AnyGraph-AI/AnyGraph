#!/bin/bash
# Run ALL post-ingest enrichment passes after parse-and-ingest.ts
# Usage: cd codegraph && bash post-ingest-all.sh
# 
# Set STRUCTURAL_ONLY=true to skip embeddings (no OpenAI API key needed).
# Everything except search_codebase and NL→Cypher works without embeddings.
set -e
cd "$(dirname "$0")"

echo "=== 1/5: Risk scoring + edge classification ==="
python3 post-ingest-enrich.py

echo ""
echo "=== 2/5: State edges (READS_STATE/WRITES_STATE) ==="
npx tsx create-state-edges.ts 2>&1 | grep -v "dotenv\|tip:"

echo ""
echo "=== 3/5: Git change frequency ==="
npx tsx seed-git-frequency.ts 2>&1 | grep -v "dotenv\|tip:"

echo ""
echo "=== 4/5: Project node ==="
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
echo "=== 5/5: Embeddings (OpenAI) ==="
npx tsx embed-nodes.ts 2>&1 | grep -v "dotenv\|tip:"

echo ""
echo "✅ All post-ingest passes complete!"
