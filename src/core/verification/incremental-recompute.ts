/**
 * TC-2: Incremental Confidence Recompute
 *
 * Scoped recompute utility that only recalculates temporal factors for
 * VerificationRun nodes affected by changed evidence/paths — never a
 * full-graph rerun unless explicitly requested.
 *
 * Recompute scope resolution:
 *   1. "node" — single VerificationRun by id
 *   2. "file"  — all runs whose CAPTURED_COMMIT references a changed file
 *   3. "task"  — all runs linked via HAS_CODE_EVIDENCE to a changed task
 *   4. "full"  — all runs in the project (requires explicit override)
 */

import { Neo4jService } from '../../storage/neo4j/neo4j.service.js';
import { computeTemporalFactors, type TemporalDecayConfig } from './temporal-confidence.js';
import { createHash } from 'crypto';

// ── Types ───────────────────────────────────────────────────────────

export type RecomputeScope = 'node' | 'file' | 'task' | 'full';

export interface RecomputeRequest {
  projectId: string;
  scope: RecomputeScope;
  /** Target id(s) — run id for 'node', file path for 'file', task id for 'task'. Ignored for 'full'. */
  targets?: string[];
  /** Required for scope='full' to prevent accidental full-graph recompute */
  fullOverride?: boolean;
  /** Optional temporal decay config override */
  decayConfig?: TemporalDecayConfig;
  reason?: string;
}

export interface RecomputeResult {
  scope: RecomputeScope;
  candidateCount: number;
  updatedCount: number;
  skippedCount: number;
  confidenceVersion: number;
  confidenceInputsHash: string;
  durationMs: number;
  reason: string;
  bounded: boolean;
}

const MAX_SCOPED_CANDIDATES = 500;

// ── Scope Resolution ────────────────────────────────────────────────

async function resolveRunIds(
  neo4j: Neo4jService,
  req: RecomputeRequest,
): Promise<string[]> {
  switch (req.scope) {
    case 'node':
      return req.targets ?? [];

    case 'file': {
      if (!req.targets?.length) return [];
      const rows = await neo4j.run(
        `UNWIND $paths AS path
         MATCH (sf:SourceFile {projectId: $projectId})
         WHERE sf.filePath ENDS WITH path
         MATCH (sf)-[:VERIFIED_BY_RUN]->(r:VerificationRun {projectId: $projectId})
         RETURN DISTINCT r.id AS id
         UNION
         UNWIND $paths AS path
         MATCH (sf:SourceFile {projectId: $projectId})
         WHERE sf.filePath ENDS WITH path
         MATCH (r:VerificationRun {projectId: $projectId})-[:CAPTURED_COMMIT]->(cs:CommitSnapshot)
         WHERE cs.diffPaths IS NOT NULL AND any(dp IN cs.diffPaths WHERE dp ENDS WITH path)
         RETURN DISTINCT r.id AS id`,
        { projectId: req.projectId, paths: req.targets },
      );
      return rows.map(r => r.id as string);
    }

    case 'task': {
      if (!req.targets?.length) return [];
      const rows = await neo4j.run(
        `UNWIND $taskIds AS taskId
         MATCH (t:Task {id: taskId, projectId: $projectId})
         MATCH (t)-[:HAS_CODE_EVIDENCE]->(sf:SourceFile)
         MATCH (sf)-[:VERIFIED_BY_RUN]->(r:VerificationRun {projectId: $projectId})
         RETURN DISTINCT r.id AS id`,
        { projectId: req.projectId, taskIds: req.targets },
      );
      return rows.map(r => r.id as string);
    }

    case 'full': {
      const rows = await neo4j.run(
        `MATCH (r:VerificationRun {projectId: $projectId})
         RETURN r.id AS id`,
        { projectId: req.projectId },
      );
      return rows.map(r => r.id as string);
    }
  }
}

// ── Inputs Hash ─────────────────────────────────────────────────────

function computeInputsHash(
  runIds: string[],
  scope: RecomputeScope,
  config: TemporalDecayConfig,
): string {
  const sorted = [...runIds].sort();
  const payload = JSON.stringify({ scope, runIds: sorted, config });
  return createHash('sha256').update(payload).digest('hex').slice(0, 32);
}

// ── Main Recompute ──────────────────────────────────────────────────

export async function incrementalRecompute(
  neo4j: Neo4jService,
  req: RecomputeRequest,
): Promise<RecomputeResult> {
  const start = Date.now();
  const reason = req.reason ?? `scoped_${req.scope}`;

  // Guard: full scope requires explicit override
  if (req.scope === 'full' && !req.fullOverride) {
    return {
      scope: 'full',
      candidateCount: 0,
      updatedCount: 0,
      skippedCount: 0,
      confidenceVersion: 0,
      confidenceInputsHash: '',
      durationMs: Date.now() - start,
      reason: 'BLOCKED: full-graph recompute requires fullOverride=true',
      bounded: false,
    };
  }

  const runIds = await resolveRunIds(neo4j, req);
  const bounded = runIds.length <= MAX_SCOPED_CANDIDATES;

  // Guard: scoped recompute must stay bounded
  if (!bounded && req.scope !== 'full') {
    return {
      scope: req.scope,
      candidateCount: runIds.length,
      updatedCount: 0,
      skippedCount: runIds.length,
      confidenceVersion: 0,
      confidenceInputsHash: '',
      durationMs: Date.now() - start,
      reason: `BLOCKED: scoped recompute resolved ${runIds.length} candidates (max ${MAX_SCOPED_CANDIDATES}). Use scope='full' with fullOverride=true.`,
      bounded: false,
    };
  }

  if (runIds.length === 0) {
    return {
      scope: req.scope,
      candidateCount: 0,
      updatedCount: 0,
      skippedCount: 0,
      confidenceVersion: 0,
      confidenceInputsHash: '',
      durationMs: Date.now() - start,
      reason: 'No candidates found',
      bounded: true,
    };
  }

  const config: TemporalDecayConfig = req.decayConfig ?? {
    decayWindowHours: 720,
    minimumFactor: 0.1,
    defaultValidityHours: 2160,
  };

  const now = new Date();

  // Fetch temporal fields for candidates
  const rows = await neo4j.run(
    `UNWIND $runIds AS rid
     MATCH (r:VerificationRun {id: rid, projectId: $projectId})
     RETURN r.id AS id, r.observedAt AS observedAt, r.validFrom AS validFrom,
            r.validTo AS validTo, r.supersededAt AS supersededAt,
            r.timeConsistencyFactor AS oldTcf, r.confidenceVersion AS oldVersion`,
    { runIds, projectId: req.projectId },
  );

  // Compute new factors, skip unchanged
  const updates: Array<{
    id: string;
    timeConsistencyFactor: number;
    retroactivePenalty: number;
    confidenceVersion: number;
  }> = [];
  let skipped = 0;

  for (const row of rows) {
    const factors = computeTemporalFactors(
      row.observedAt as string | null,
      row.validFrom as string | null,
      row.validTo as string | null,
      row.supersededAt as string | null,
      now,
      config,
    );

    const oldTcf = row.oldTcf as number | null;
    // Skip if factor unchanged (within epsilon)
    if (oldTcf !== null && Math.abs(oldTcf - factors.timeConsistencyFactor) < 0.001) {
      skipped++;
      continue;
    }

    const oldVersion = (row.oldVersion as number | null) ?? 0;
    updates.push({
      id: row.id as string,
      timeConsistencyFactor: factors.timeConsistencyFactor,
      retroactivePenalty: factors.retroactivePenalty,
      confidenceVersion: oldVersion + 1,
    });
  }

  const inputsHash = computeInputsHash(runIds, req.scope, config);

  // Batch update with provenance
  if (updates.length > 0) {
    await neo4j.run(
      `UNWIND $updates AS u
       MATCH (r:VerificationRun {id: u.id, projectId: $projectId})
       SET r.timeConsistencyFactor = u.timeConsistencyFactor,
           r.retroactivePenalty = u.retroactivePenalty,
           r.confidenceVersion = u.confidenceVersion,
           r.confidenceInputsHash = $inputsHash,
           r.lastRecomputeAt = $now,
           r.recomputeReason = $reason`,
      {
        updates,
        projectId: req.projectId,
        inputsHash,
        now: now.toISOString(),
        reason,
      },
    );
  }

  // Get max version for result
  const maxVersion = updates.reduce((m, u) => Math.max(m, u.confidenceVersion), 0);

  return {
    scope: req.scope,
    candidateCount: runIds.length,
    updatedCount: updates.length,
    skippedCount: skipped,
    confidenceVersion: maxVersion,
    confidenceInputsHash: inputsHash,
    durationMs: Date.now() - start,
    reason,
    bounded,
  };
}
