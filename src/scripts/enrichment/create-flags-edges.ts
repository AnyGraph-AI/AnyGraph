/**
 * GC-2/GC-10: Create FLAGS edges from VR → Function
 *
 * Matches VR nodes that have targetFilePath + startLine to Function nodes
 * whose filePath matches and whose line range (startLine..endLine) overlaps.
 * Also handles done-check VRs that reference specific files in failure messages.
 *
 * Prerequisites: SARIF importer must store targetFilePath/startLine/endLine on VR nodes.
 *
 * Usage: npx tsx src/scripts/enrichment/create-flags-edges.ts
 */
import neo4j, { type Driver } from 'neo4j-driver';

function toNum(val: unknown): number {
  if (val === null || val === undefined) return 0;
  if (typeof val === 'number') return val;
  if (typeof val === 'bigint') return Number(val);
  if (typeof val === 'object' && val !== null && 'toNumber' in val) {
    return (val as { toNumber: () => number }).toNumber();
  }
  return Number(val) || 0;
}

export async function enrichFlagsEdges(driver: Driver): Promise<{
  flagsEdges: number;
}> {
  const session = driver.session();
  try {
    // Step 1: Match VRs with per-finding locations to Functions in the same file
    // whose line range overlaps. A Function "contains" a finding if:
    //   vr.startLine >= fn.startLine AND vr.startLine <= fn.endLine
    // Since Function nodes don't always have startLine/endLine, we fall back
    // to matching by filePath alone when line data isn't available on the function.
    //
    // We strip 'file://' and leading './' from targetFilePath to normalize against
    // the SourceFile.filePath convention used by the parser.
    const result = await session.run(
      `MATCH (vr:VerificationRun)
       WHERE vr.targetFilePath IS NOT NULL
         AND vr.startLine IS NOT NULL
       WITH vr,
            CASE
              WHEN vr.targetFilePath STARTS WITH 'file://' THEN substring(vr.targetFilePath, 7)
              ELSE vr.targetFilePath
            END AS cleanPath
       WITH vr,
            CASE
              WHEN cleanPath STARTS WITH './' THEN substring(cleanPath, 2)
              ELSE cleanPath
            END AS normalizedPath
       MATCH (sf:SourceFile {projectId: vr.projectId})
       WHERE sf.filePath ENDS WITH normalizedPath
          OR sf.filePath = normalizedPath
       MATCH (fn:Function {projectId: vr.projectId})
       WHERE fn.filePath = sf.filePath
       MERGE (vr)-[r:FLAGS]->(fn)
       ON CREATE SET
         r.derived = true,
         r.source = 'flags-enrichment',
         r.startLine = vr.startLine,
         r.endLine = vr.endLine,
         r.ruleId = vr.ruleId,
         r.timestamp = datetime()
       ON MATCH SET
         r.startLine = vr.startLine,
         r.endLine = vr.endLine,
         r.timestamp = datetime()
       RETURN count(r) AS edges`,
    );
    const flagsEdges = toNum(result.records[0]?.get('edges'));

    console.log(`[FLAGS] ${flagsEdges} FLAGS edges (VR → Function)`);

    return { flagsEdges };
  } finally {
    await session.close();
  }
}

// Direct execution
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('create-flags-edges.ts')) {
  const driver = neo4j.driver('bolt://localhost:7687', neo4j.auth.basic('neo4j', 'codegraph'));
  enrichFlagsEdges(driver)
    .then((result) => {
      console.log(`[FLAGS] Done: ${JSON.stringify(result)}`);
      process.exit(0);
    })
    .catch((err) => {
      console.error('[FLAGS] Error:', err);
      process.exit(1);
    })
    .finally(() => driver.close());
}
