#!/usr/bin/env node
/**
 * RF-2: Enforcement Gate CLI
 *
 * Usage:
 *   codegraph enforce <file1> [file2] [--mode enforced] [--blast-radius] [--project-id ID]
 *   npm run enforce -- src/core/verification/sarif-importer.ts --mode enforced
 *
 * Exit codes:
 *   0 = ALLOW
 *   1 = BLOCK or error
 *   2 = REQUIRE_APPROVAL
 */

import 'dotenv/config';
import { Neo4jService } from '../../storage/neo4j/neo4j.service.js';
import { evaluateEnforcementGate, DEFAULT_CONFIG, type GateMode } from '../../core/enforcement/enforcement-gate.js';
import { resolveAffectedNodes, resolveBlastRadius } from '../../core/enforcement/graph-resolver.js';
import path from 'path';

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log(`
RF-2 Enforcement Gate — evaluate edit risk from graph

Usage: codegraph enforce <file1> [file2...] [options]

Options:
  --mode <advisory|assisted|enforced>  Gate mode (default: advisory)
  --blast-radius                       Include downstream CALLS impact
  --blast-depth <N>                    Max hop depth for blast radius (default: 3)
  --project-id <ID>                    Project ID (default: auto-detect)
  --json                               Output JSON instead of markdown

Exit codes: 0=ALLOW, 1=BLOCK, 2=REQUIRE_APPROVAL
`);
    process.exit(0);
  }

  // Parse args
  const filePaths: string[] = [];
  let mode: GateMode = 'advisory';
  let blastRadius = false;
  let blastDepth = 3;
  let projectId = 'proj_c0d3e9a1f200';
  let jsonOutput = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--mode' && args[i + 1]) {
      mode = args[++i] as GateMode;
    } else if (args[i] === '--blast-radius') {
      blastRadius = true;
    } else if (args[i] === '--blast-depth' && args[i + 1]) {
      blastDepth = parseInt(args[++i], 10);
    } else if (args[i] === '--project-id' && args[i + 1]) {
      projectId = args[++i];
    } else if (args[i] === '--json') {
      jsonOutput = true;
    } else if (!args[i].startsWith('--')) {
      filePaths.push(path.resolve(args[i]));
    }
  }

  if (filePaths.length === 0) {
    console.error('Error: no file paths provided');
    process.exit(1);
  }

  const neo4j = new Neo4jService();
  try {
    // Resolve affected nodes
    const affectedNodes = await resolveAffectedNodes(neo4j, filePaths, projectId);

    // Optional blast radius
    let blastRadiusNodes: Awaited<ReturnType<typeof resolveBlastRadius>> = [];
    if (blastRadius) {
      blastRadiusNodes = await resolveBlastRadius(
        neo4j,
        affectedNodes.map(n => n.id),
        projectId,
        blastDepth,
      );
    }

    // Evaluate
    const config = { ...DEFAULT_CONFIG, mode };
    const result = evaluateEnforcementGate(config, affectedNodes);

    if (jsonOutput) {
      console.log(JSON.stringify({ ...result, blastRadius: blastRadiusNodes }, null, 2));
    } else {
      // Human-readable output
      const icon = result.decision === 'ALLOW' ? '✅' : result.decision === 'BLOCK' ? '🚫' : '⚠️';
      console.log(`${icon} ${result.decision}: ${result.reason}`);
      console.log(`   Mode: ${mode} | Hash: ${result.decisionHash}`);
      console.log(`   Risk: ${result.riskSummary.criticalCount} CRITICAL, ${result.riskSummary.highCount} HIGH, ${result.riskSummary.totalAffected} total`);

      if (result.riskSummary.untestedCriticalCount > 0) {
        console.log(`   ⚠️  ${result.riskSummary.untestedCriticalCount} CRITICAL function(s) have NO test coverage`);
      }

      if (result.approvalRequired) {
        console.log(`   Approval needed: ${result.approvalRequired.affectedCriticalNodes.join(', ')}`);
        if (result.approvalRequired.expiresAt) {
          console.log(`   Expires: ${result.approvalRequired.expiresAt}`);
        }
      }

      if (blastRadiusNodes.length > 0) {
        console.log(`   Blast radius: ${blastRadiusNodes.length} downstream functions via CALLS`);
      }
    }

    // Exit code
    if (result.decision === 'BLOCK') process.exit(1);
    if (result.decision === 'REQUIRE_APPROVAL') process.exit(2);
    process.exit(0);
  } catch (err: any) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  } finally {
    await neo4j.close();
  }
}

main();
