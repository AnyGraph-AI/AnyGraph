"""
Post-ingest enrichment: compute derived properties on the Neo4j graph.
Run after parse-and-ingest.ts to add risk scoring and edge classification.
"""
import json
import urllib.request

NEO4J_URL = "http://localhost:7474/db/neo4j/query/v2"
AUTH = "neo4j:codegraph"

def query(statement, params=None):
    """Execute a Cypher query via HTTP API."""
    import base64
    body = json.dumps({"statement": statement, "parameters": params or {}}).encode()
    req = urllib.request.Request(NEO4J_URL, body, {
        "Content-Type": "application/json",
        "Authorization": "Basic " + base64.b64encode(AUTH.encode()).decode()
    })
    with urllib.request.urlopen(req) as resp:
        result = json.loads(resp.read())
        if "errors" in result and result["errors"]:
            print(f"ERROR: {result['errors']}")
            return None
        return result

def run(label, cypher):
    """Run a query and print result."""
    result = query(cypher)
    if result and "data" in result:
        vals = result["data"]["values"]
        if vals:
            print(f"  ✓ {label}: {vals[0][0] if len(vals[0]) == 1 else vals[0]}")
        else:
            print(f"  ✓ {label}: (no results)")
    else:
        print(f"  ✗ {label}: failed")

print("=== FUNCTION METRICS ===")

run("fanInCount", """
    MATCH (fn:Function)
    OPTIONAL MATCH (caller)-[:CALLS]->(fn)
    WITH fn, count(DISTINCT caller) AS fanIn
    SET fn.fanInCount = fanIn
    RETURN count(fn)
""")

run("fanOutCount", """
    MATCH (fn:Function)
    OPTIONAL MATCH (fn)-[:CALLS]->(callee)
    WITH fn, count(DISTINCT callee) AS fanOut
    SET fn.fanOutCount = fanOut
    RETURN count(fn)
""")

run("lineCount", """
    MATCH (fn:Function)
    WHERE fn.startLine IS NOT NULL AND fn.endLine IS NOT NULL
    SET fn.lineCount = fn.endLine - fn.startLine
    RETURN count(fn)
""")

run("parameterCount", """
    MATCH (fn:Function)
    OPTIONAL MATCH (fn)-[:HAS_PARAMETER]->(p)
    WITH fn, count(p) AS params
    SET fn.parameterCount = params
    RETURN count(fn)
""")

run("riskLevel", """
    MATCH (fn:Function)
    WHERE fn.fanInCount IS NOT NULL AND fn.fanOutCount IS NOT NULL
    SET fn.riskLevel = fn.fanInCount * fn.fanOutCount * log(toFloat(coalesce(fn.lineCount, 1)) + 1.0)
    RETURN count(fn)
""")

run("riskTier", """
    MATCH (fn:Function)
    SET fn.riskTier = CASE
        WHEN fn.riskLevel > 500 THEN 'CRITICAL'
        WHEN fn.riskLevel > 100 THEN 'HIGH'
        WHEN fn.riskLevel > 20 THEN 'MEDIUM'
        ELSE 'LOW'
    END
    RETURN count(fn)
""")

print("\n=== CALLS EDGE CLASSIFICATION ===")

run("crossFile", """
    MATCH (src:CodeNode)-[r:CALLS]->(tgt:CodeNode)
    SET r.crossFile = (src.filePath <> tgt.filePath)
    RETURN count(r)
""")

# Parse context JSON to extract resolutionKind and isAsync
run("resolutionKind (fluent)", """
    MATCH ()-[r:CALLS]->()
    WHERE r.context IS NOT NULL AND r.context CONTAINS '"receiverType"'
    SET r.resolutionKind = 'fluent'
    RETURN count(r)
""")

run("resolutionKind (internal)", """
    MATCH ()-[r:CALLS]->()
    WHERE r.resolutionKind IS NULL
    SET r.resolutionKind = 'internal'
    RETURN count(r)
""")

run("isAsync", """
    MATCH ()-[r:CALLS]->()
    WHERE r.context IS NOT NULL AND r.context CONTAINS '"isAsync":true'
    SET r.isAsync = true
    RETURN count(r)
""")

run("isAsync (false)", """
    MATCH ()-[r:CALLS]->()
    WHERE r.isAsync IS NULL
    SET r.isAsync = false
    RETURN count(r)
""")

# Mark calls from handlers
run("callerIsHandler", """
    MATCH (h:Function)-[r:CALLS]->(callee)
    WHERE (h)-[:REGISTERED_BY]->()
    SET r.callerIsHandler = true
    RETURN count(r)
""")

run("callerIsHandler (false)", """
    MATCH ()-[r:CALLS]->()
    WHERE r.callerIsHandler IS NULL
    SET r.callerIsHandler = false
    RETURN count(r)
""")

print("\n=== SOURCEFILE METRICS ===")

run("fileNodeCount", """
    MATCH (sf:SourceFile)
    OPTIONAL MATCH (sf)-[:CONTAINS]->(n)
    WITH sf, count(n) AS nodeCount
    SET sf.nodeCount = nodeCount
    RETURN count(sf)
""")

run("fileFunctionCount", """
    MATCH (sf:SourceFile)
    OPTIONAL MATCH (sf)-[:CONTAINS]->(fn:Function)
    WITH sf, count(fn) AS funcCount
    SET sf.functionCount = funcCount
    RETURN count(sf)
""")

run("fileImportCount", """
    MATCH (sf:SourceFile)
    OPTIONAL MATCH (sf)-[:IMPORTS]->(other:SourceFile)
    WITH sf, count(other) AS impCount
    SET sf.importCount = impCount
    RETURN count(sf)
""")

# File coupling: how many other files depend on this file?
run("fileDependentCount", """
    MATCH (sf:SourceFile)
    OPTIONAL MATCH (other:SourceFile)-[:IMPORTS]->(sf)
    WITH sf, count(other) AS depCount
    SET sf.dependentCount = depCount
    RETURN count(sf)
""")

print("\n=== VERIFICATION ===")

# Risk tier distribution
result = query("""
    MATCH (fn:Function)
    RETURN fn.riskTier AS tier, count(*) AS count
    ORDER BY count DESC
""")
if result:
    print("Risk tiers:")
    for r in result["data"]["values"]:
        print(f"  {r[0]}: {r[1]}")

# Top 10 riskiest
result = query("""
    MATCH (fn:Function)
    WHERE fn.riskLevel > 0
    RETURN fn.name, fn.fanInCount, fn.fanOutCount, fn.lineCount,
           round(fn.riskLevel * 100) / 100, fn.riskTier
    ORDER BY fn.riskLevel DESC LIMIT 10
""")
if result:
    print(f"\n{'Name':<30} {'FanIn':>6} {'FanOut':>7} {'Lines':>6} {'Risk':>10} {'Tier':<10}")
    print("-" * 75)
    for r in result["data"]["values"]:
        print(f"{str(r[0]):<30} {r[1]:>6} {r[2]:>7} {r[3]:>6} {r[4]:>10.1f} {r[5]:<10}")

# Cross-file stats
result = query("""
    MATCH ()-[r:CALLS]->()
    RETURN r.crossFile AS crossFile, r.resolutionKind AS kind, count(*) AS cnt
    ORDER BY cnt DESC
""")
if result:
    print("\nCALLS edge breakdown:")
    for r in result["data"]["values"]:
        print(f"  crossFile={r[0]}, kind={r[1]}: {r[2]}")

# Async calls
result = query("""
    MATCH ()-[r:CALLS]->()
    RETURN r.isAsync AS async, count(*) AS cnt
""")
if result:
    print("\nAsync calls:")
    for r in result["data"]["values"]:
        print(f"  isAsync={r[0]}: {r[1]}")

# Handler calls
result = query("""
    MATCH ()-[r:CALLS]->()
    RETURN r.callerIsHandler AS fromHandler, count(*) AS cnt
""")
if result:
    print("\nHandler origin:")
    for r in result["data"]["values"]:
        print(f"  callerIsHandler={r[0]}: {r[1]}")

# File coupling
result = query("""
    MATCH (sf:SourceFile)
    WHERE sf.dependentCount > 0
    RETURN sf.name, sf.functionCount, sf.importCount, sf.dependentCount
    ORDER BY sf.dependentCount DESC LIMIT 10
""")
if result:
    print(f"\n{'File':<35} {'Funcs':>6} {'Imports':>8} {'Dependents':>11}")
    print("-" * 65)
    for r in result["data"]["values"]:
        name = str(r[0]).split("/")[-1] if r[0] else "?"
        print(f"{name:<35} {r[1]:>6} {r[2]:>8} {r[3]:>11}")

print("\n✅ Post-ingest enrichment complete!")
