import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { z } from 'zod';

import { createErrorResponse, createSuccessResponse } from '../utils.js';

interface CommitAuditArtifact {
  ok: boolean;
  generatedAt: string;
  baseRef: string;
  headRef: string;
  commitCount: number;
  changedFiles: string[];
  invariants: Array<{
    key: string;
    ok: boolean;
    summary: string;
    details?: Record<string, unknown>;
  }>;
  failingInvariantKeys: string[];
  confidence: number;
  anomalyDeltas: Array<{
    projectId: string;
    nodeCountDelta: number;
    edgeCountDelta: number;
    unresolvedLocalDelta: number;
    invariantViolationDelta: number;
    duplicateSourceSuspicionDelta: number;
  }>;
  roadmapTaskLinks: Array<{ invariant: string; task: string; line: number }>;
}

function loadLatestArtifact(): CommitAuditArtifact | null {
  const artifactPath = join(process.cwd(), 'artifacts', 'commit-audit', 'latest.json');
  if (!existsSync(artifactPath)) return null;

  try {
    const raw = readFileSync(artifactPath, 'utf8');
    return JSON.parse(raw) as CommitAuditArtifact;
  } catch {
    return null;
  }
}

export function createCommitAuditStatusTool(server: McpServer) {
  server.tool(
    'commit_audit_status',
    'Shows latest graph-native commit audit status (invariants, confidence, anomaly deltas, roadmap links).',
    {
      failingOnly: z.boolean().optional().describe('Show only failing invariants and linked roadmap tasks'),
      includeChangedFiles: z.boolean().optional().describe('Include changed-file list from the audited commit range'),
    },
    async (args) => {
      try {
        const artifact = loadLatestArtifact();
        if (!artifact) {
          return createErrorResponse('No commit audit artifact found at artifacts/commit-audit/latest.json.');
        }

        const failingOnly = Boolean(args.failingOnly);
        const includeChangedFiles = Boolean(args.includeChangedFiles);

        const lines: string[] = [];
        lines.push('# 🧪 Commit Audit Status\n');
        lines.push(`- Status: ${artifact.ok ? '✅ PASS' : '❌ FAIL'}`);
        lines.push(`- Generated: ${artifact.generatedAt}`);
        lines.push(`- Range: ${artifact.baseRef}..${artifact.headRef}`);
        lines.push(`- Commits: ${artifact.commitCount}`);
        lines.push(`- Confidence: ${artifact.confidence}`);

        const invariants = failingOnly
          ? artifact.invariants.filter((inv) => !inv.ok)
          : artifact.invariants;

        lines.push('\n## Invariants');
        if (invariants.length === 0) {
          lines.push('- No invariant rows to display.');
        } else {
          for (const inv of invariants) {
            lines.push(`- ${inv.ok ? '✅' : '❌'} ${inv.key} — ${inv.summary}`);
          }
        }

        lines.push('\n## Anomaly Deltas (latest snapshot vs previous)');
        if (artifact.anomalyDeltas.length === 0) {
          lines.push('- No non-zero deltas detected.');
        } else {
          for (const d of artifact.anomalyDeltas) {
            lines.push(
              `- [${d.projectId}] nodes ${d.nodeCountDelta >= 0 ? '+' : ''}${d.nodeCountDelta}, edges ${d.edgeCountDelta >= 0 ? '+' : ''}${d.edgeCountDelta}, unresolved ${d.unresolvedLocalDelta >= 0 ? '+' : ''}${d.unresolvedLocalDelta}, violations ${d.invariantViolationDelta >= 0 ? '+' : ''}${d.invariantViolationDelta}`,
            );
          }
        }

        const links = failingOnly
          ? artifact.roadmapTaskLinks
          : artifact.roadmapTaskLinks;

        lines.push('\n## Roadmap Auto-Links');
        if (links.length === 0) {
          lines.push('- No failing invariants; no remediation links required.');
        } else {
          for (const link of links) {
            lines.push(`- [${link.invariant}] L${link.line}: ${link.task}`);
          }
        }

        if (includeChangedFiles) {
          lines.push('\n## Changed Files');
          if (artifact.changedFiles.length === 0) {
            lines.push('- (none)');
          } else {
            for (const file of artifact.changedFiles) lines.push(`- ${file}`);
          }
        }

        return createSuccessResponse(lines.join('\n'));
      } catch (error) {
        return createErrorResponse(error instanceof Error ? error.message : String(error));
      }
    },
  );
}
