/**
 * Ground Truth Hook — Runtime (GTH-1 Task 2)
 *
 * GroundTruthRuntime is the domain-blind orchestrator. It:
 * - Runs core integrity surfaces (schema, referential, provenance, freshness)
 * - Delegates domain surfaces to the pack
 * - Orchestrates all three panels
 * - Manages check tiering (fast/medium/heavy)
 *
 * The runtime is a COMPOSER of existing MCP tools, not a replacement.
 */

import { Neo4jService } from '../../storage/neo4j/neo4j.service.js';
import type { GroundTruthPack } from './pack-interface.js';
import { computeDelta } from './delta.js';
import type {
  CheckTier,
  IntegrityFinding,
  IntegrityReport,
  GroundTruthOutput,
  Panel1Output,
  Panel2Output,
  Panel3Output,
  Observation,
} from './types.js';

export interface GroundTruthOptions {
  /** Project ID (e.g., 'proj_c0d3e9a1f200') */
  projectId: string;
  /** Plan project ID (e.g., 'plan_codegraph') — derived from projectId if not given */
  planProjectId?: string;
  /** Agent ID for Panel 2 (SessionBookmark lookup) */
  agentId?: string;
  /** Current task ID (if claimed) */
  currentTaskId?: string;
  /** Files touched in current work */
  filesTouched?: string[];
  /** Check depth: fast (every call), medium (/sync), heavy (/sync full) */
  depth?: CheckTier;
}

/**
 * Core integrity check definition.
 * Each check has a Cypher query, expected value, and tier.
 */
interface CoreIntegrityCheck {
  id: string;
  surface: 'schema' | 'referential' | 'provenance' | 'freshness';
  severity: 'critical' | 'warning' | 'info';
  description: string;
  tier: CheckTier;
  /** Cypher query that returns a single numeric value */
  cypher: string;
  /** Expected value (0 = no violations) */
  expected: number;
  /** Parameters for the Cypher query */
  params?: Record<string, unknown>;
}

// ─── Core Integrity Check Definitions ───────────────────────────────

const CORE_CHECKS: CoreIntegrityCheck[] = [
  // ── Fast tier (every invocation) ──
  {
    id: 'plan_freshness',
    surface: 'freshness',
    severity: 'warning',
    description: 'GovernanceMetricSnapshot is current (< 4h old)',
    tier: 'fast',
    cypher: `
      MATCH (g:GovernanceMetricSnapshot {projectId: $projectId})
      WITH g ORDER BY g.timestamp DESC LIMIT 1
      RETURN CASE
        WHEN g IS NULL THEN 1
        WHEN duration.between(datetime(g.timestamp), datetime()).hours >= 4 THEN 1
        ELSE 0
      END AS stale
    `,
    expected: 0,
  },
  {
    id: 'integrity_snapshot_freshness',
    surface: 'freshness',
    severity: 'warning',
    description: 'IntegritySnapshot exists and is less than 30h old',
    tier: 'fast',
    cypher: `
      MATCH (s:IntegritySnapshot {projectId: $projectId})
      WITH s ORDER BY s.timestamp DESC LIMIT 1
      RETURN CASE
        WHEN s IS NULL THEN 1
        WHEN duration.between(datetime(s.timestamp), datetime()).hours >= 30 THEN 1
        ELSE 0
      END AS stale
    `,
    expected: 0,
  },

  // ── Medium tier (periodic, on /sync) ──
  {
    id: 'missing_codenode_label',
    surface: 'schema',
    severity: 'warning',
    description: 'TypeScript nodes without CodeNode label (GRC-4)',
    tier: 'medium',
    cypher: `
      MATCH (n)
      WHERE "TypeScript" IN labels(n)
        AND NOT "CodeNode" IN labels(n)
        AND NOT "IRNode" IN labels(n)
      RETURN count(n) AS cnt
    `,
    expected: 0,
  },
  {
    id: 'null_projectid_entities',
    surface: 'referential',
    severity: 'critical',
    description: 'Non-exempt nodes with NULL projectId (GRC-11)',
    tier: 'medium',
    cypher: `
      MATCH (n)
      WHERE n.projectId IS NULL
        AND NOT any(l IN labels(n) WHERE l IN [
          'Person', 'CanonicalEntity', 'Evidence', 'Claim', 'Hypothesis',
          'Author', 'ArchitectureLayer', 'IntegritySnapshot', 'MetricResult'
        ])
        AND NOT "IRNode" IN labels(n)
      RETURN count(n) AS cnt
    `,
    expected: 0,
  },
  {
    id: 'sourcefile_label_model',
    surface: 'schema',
    severity: 'warning',
    description: 'SourceFile nodes use correct label pattern (CodeNode:SourceFile:TypeScript, not bare SourceFile)',
    tier: 'medium',
    cypher: `
      MATCH (n)
      WHERE "SourceFile" IN labels(n)
        AND NOT "CodeNode" IN labels(n)
        AND NOT "IRNode" IN labels(n)
        AND n.projectId IS NOT NULL
      RETURN count(n) AS cnt
    `,
    expected: 0,
  },
  {
    id: 'missing_sourceKind_on_edges',
    surface: 'provenance',
    severity: 'warning',
    description: 'Code edges missing sourceKind provenance',
    tier: 'medium',
    cypher: `
      MATCH ()-[r:CALLS|CONTAINS|IMPORTS|RESOLVES_TO|REGISTERED_BY]->()
      WHERE r.sourceKind IS NULL
      RETURN count(r) AS cnt
    `,
    expected: 0,
  },
  {
    id: 'hollow_verification_runs',
    surface: 'provenance',
    severity: 'warning',
    description: 'VerificationRun nodes without meaningful tool/status data (GRC-3)',
    tier: 'medium',
    cypher: `
      MATCH (v:VerificationRun)
      WHERE v.tool IS NULL OR v.status IS NULL
      RETURN count(v) AS cnt
    `,
    expected: 0,
  },
  {
    id: 'orphaned_evidence_targets',
    surface: 'referential',
    severity: 'warning',
    description: 'HAS_CODE_EVIDENCE edges pointing at heterogeneous/missing targets (GRC-5)',
    tier: 'medium',
    cypher: `
      MATCH (t:Task)-[e:HAS_CODE_EVIDENCE]->(target)
      WHERE NOT "SourceFile" IN labels(target)
        AND NOT "CodeNode" IN labels(target)
        AND NOT "Function" IN labels(target)
      RETURN count(e) AS cnt
    `,
    expected: 0,
  },

  // ── Heavy tier (on-demand, /sync full) ──
  {
    id: 'edge_taxonomy_violations',
    surface: 'schema',
    severity: 'critical',
    description: 'Edges with unknown relationship types',
    tier: 'heavy',
    cypher: `
      MATCH ()-[r]->()
      WHERE NOT type(r) IN [
        'CALLS', 'CONTAINS', 'IMPORTS', 'RESOLVES_TO', 'REGISTERED_BY',
        'READS_STATE', 'WRITES_STATE', 'POSSIBLE_CALL', 'OWNED_BY',
        'BELONGS_TO_LAYER', 'HAS_PARAMETER', 'HAS_MEMBER', 'EXTENDS',
        'IMPLEMENTS', 'ORIGINATES_IN', 'CO_CHANGES_WITH',
        'PART_OF', 'DEPENDS_ON', 'BLOCKS', 'HAS_CODE_EVIDENCE', 'TARGETS',
        'NEXT_STAGE', 'READS_PLAN_FIELD', 'MUTATES_TASK_FIELD',
        'EMITS_NODE_TYPE', 'EMITS_EDGE_TYPE',
        'SUPPORTED_BY', 'CONTRADICTED_BY', 'WITNESSES', 'PROVES',
        'ANCHORS', 'CROSS_REFERENCES', 'MENTIONS_PERSON', 'MENTIONS',
        'MEASURED', 'DERIVED_FROM_PROOF', 'DERIVED_FROM_RUN',
        'DERIVED_FROM_COMMIT', 'DERIVED_FROM_GATE', 'AFFECTS_COMMIT',
        'CAPTURED_COMMIT', 'CAPTURED_WORKTREE', 'EMITS_GATE_DECISION',
        'BASED_ON_RUN', 'GENERATED_ARTIFACT', 'USED_BY',
        'HAS_SCOPE', 'UNSCANNED_FOR', 'ADJUDICATES', 'ILLUSTRATES',
        'NEXT_VERSE', 'OBSERVED_AS', 'PRODUCED', 'GENERATED_HYPOTHESIS',
        'BECAME_TASK', 'RESOLVED_BY_COMMIT',
        'TOUCHED', 'REFERENCED', 'COMMIT_REFERENCES_TASK', 'VERIFIED_BY_RUN',
        'APPLIES_TO', 'HAS_OWNER', 'TRIGGERED_BY', 'DEFINES_TOPOLOGY',
        'OWNS_SCOPE', 'MEASURED_BY',
        'CURATED_PARALLEL', 'TARGETS_FAILURE_CLASS', 'DEFINES_CONTROL',
        'DEFINES_FAILURE_CLASS', 'USES_SCHEMA_VERSION', 'DEFINES_PROFILE',
        'DEFINES_PROOF_SCOPE', 'REFERENCES'
      ]
      RETURN count(r) AS cnt
    `,
    expected: 0,
  },
  {
    id: 'claim_orphans',
    surface: 'referential',
    severity: 'info',
    description: 'Claims without any SUPPORTED_BY evidence',
    tier: 'heavy',
    cypher: `
      MATCH (c:Claim)
      WHERE NOT (c)-[:SUPPORTED_BY]->()
      RETURN count(c) AS cnt
    `,
    expected: 0,
  },
  {
    id: 'risk_type_consistency',
    surface: 'schema',
    severity: 'warning',
    description: 'riskLevel is numeric and riskTier is string (GRC-13)',
    tier: 'heavy',
    cypher: `
      MATCH (n:CodeNode)
      WHERE n.riskLevel IS NOT NULL AND NOT toFloat(toString(n.riskLevel)) IS NOT NULL
      RETURN count(n) AS cnt
    `,
    expected: 0,
  },
];

/**
 * GroundTruthRuntime — the domain-blind orchestrator.
 */
export class GroundTruthRuntime {
  private neo4j: Neo4jService;
  private pack: GroundTruthPack;

  constructor(pack: GroundTruthPack, neo4j?: Neo4jService) {
    this.pack = pack;
    this.neo4j = neo4j ?? new Neo4jService();
  }

  /**
   * Run the full ground truth hook — all three panels.
   */
  async run(options: GroundTruthOptions): Promise<GroundTruthOutput> {
    const startMs = Date.now();
    const depth = options.depth ?? 'fast';
    const planProjectId = options.planProjectId ?? this.derivePlanProjectId(options.projectId);

    const [panel1, panel2, rawPanel3] = await Promise.all([
      this.runPanel1(options.projectId, planProjectId, depth, options.currentTaskId, options.filesTouched),
      this.runPanel2(options.agentId, options.projectId),
      this.runPanel3(options.currentTaskId, options.filesTouched, options.projectId),
    ]);

    // Compute deltas using the delta engine (GTH-3)
    const panel3 = computeDelta({
      panel1,
      panel2,
      transitiveImpact: rawPanel3.transitiveImpact,
      candidateModifies: rawPanel3.candidateModifies,
    });

    return {
      panel1,
      panel2,
      panel3,
      meta: {
        runAt: new Date().toISOString(),
        projectId: options.projectId,
        depth,
        durationMs: Date.now() - startMs,
      },
    };
  }

  // ─── Panel 1: Graph State ───────────────────────────────────────

  private async runPanel1(
    projectId: string,
    planProjectId: string,
    depth: CheckTier,
    currentTaskId?: string,
    filesTouched?: string[],
  ): Promise<Panel1Output> {
    const [planStatus, governanceHealth, evidenceCoverage, relevantClaims, integrity] =
      await Promise.all([
        this.pack.queryPlanStatus(planProjectId),
        this.pack.queryGovernanceHealth(projectId),
        this.pack.queryEvidenceCoverage(planProjectId),
        currentTaskId
          ? this.pack.queryRelevantClaims(currentTaskId, filesTouched ?? [], projectId)
          : Promise.resolve([]),
        this.panel1B(projectId, depth),
      ]);

    return { planStatus, governanceHealth, evidenceCoverage, relevantClaims, integrity };
  }

  /**
   * Panel 1B: Graph Integrity.
   * Core surfaces (runtime) + domain surfaces (pack).
   */
  async panel1B(projectId: string, depth: CheckTier = 'medium'): Promise<IntegrityReport> {
    const [core, domain] = await Promise.all([
      this.queryCoreIntegrity(projectId, depth),
      this.pack.queryIntegritySurfaces(projectId),
    ]);

    const allFindings = [...core, ...domain];
    const failed = allFindings.filter(f => !f.pass);

    return {
      core,
      domain,
      summary: {
        totalChecks: allFindings.length,
        passed: allFindings.filter(f => f.pass).length,
        failed: failed.length,
        criticalFailures: failed.filter(f => f.severity === 'critical').length,
      },
    };
  }

  /**
   * Core integrity surfaces — universal, every domain.
   * Schema, referential, provenance, freshness.
   */
  private async queryCoreIntegrity(
    projectId: string,
    depth: CheckTier,
  ): Promise<IntegrityFinding[]> {
    const tierOrder: Record<CheckTier, number> = { fast: 0, medium: 1, heavy: 2 };
    const maxTier = tierOrder[depth];

    const eligibleChecks = CORE_CHECKS.filter(
      c => tierOrder[c.tier] <= maxTier,
    );

    // Run all checks in parallel (ℹ️-2) — each has independent error handling
    const findings = await Promise.all(
      eligibleChecks.map(async (check): Promise<IntegrityFinding> => {
        try {
          const params = { projectId, ...(check.params ?? {}) };
          const rows = await this.neo4j.run(check.cypher, params);
          const row = rows[0];
          const observedValue = row
            ? Number(Object.values(row)[0]?.toString() ?? '0')
            : 0;

          return {
            definitionId: check.id,
            surface: check.surface,
            surfaceClass: 'core',
            severity: check.severity,
            description: check.description,
            observedValue,
            expectedValue: check.expected,
            pass: observedValue === check.expected,
            trend: 'new', // Will be computed from historical observations in GTH-7
            tier: check.tier,
            observedAt: new Date().toISOString(),
          };
        } catch (err) {
          return {
            definitionId: check.id,
            surface: check.surface,
            surfaceClass: 'core',
            severity: 'critical',
            description: `CHECK FAILED TO EXECUTE: ${check.description} — ${(err as Error).message}`,
            observedValue: -1,
            expectedValue: check.expected,
            pass: false,
            trend: 'new',
            tier: check.tier,
            observedAt: new Date().toISOString(),
          };
        }
      }),
    );

    return findings;
  }

  // ─── Panel 2: Agent State ───────────────────────────────────────

  private async runPanel2(
    agentId?: string,
    projectId?: string,
  ): Promise<Panel2Output> {
    if (!agentId) {
      return {
        agentId: 'unknown',
        status: 'IDLE',
        currentTaskId: null,
        currentMilestone: null,
        sessionBookmark: null,
      };
    }

    try {
      const rows = await this.neo4j.run(
        `MATCH (b:SessionBookmark {agentId: $agentId})
         WHERE b.projectId = $projectId OR $projectId IS NULL
         RETURN properties(b) AS props ORDER BY b.createdAt DESC LIMIT 1`,
        { agentId, projectId: projectId ?? null },
      );

      if (rows.length === 0) {
        return {
          agentId,
          status: 'IDLE',
          currentTaskId: null,
          currentMilestone: null,
          sessionBookmark: null,
        };
      }

      const bookmark = rows[0].props as Record<string, unknown>;
      return {
        agentId,
        status: String(bookmark.status ?? 'IDLE'),
        currentTaskId: bookmark.currentTaskId != null ? String(bookmark.currentTaskId) : null,
        currentMilestone: bookmark.currentMilestone != null ? String(bookmark.currentMilestone) : null,
        sessionBookmark: bookmark,
      };
    } catch {
      return {
        agentId,
        status: 'IDLE',
        currentTaskId: null,
        currentMilestone: null,
        sessionBookmark: null,
      };
    }
  }

  // ─── Panel 3: Delta ─────────────────────────────────────────────

  private async runPanel3(
    currentTaskId?: string,
    filesTouched?: string[],
    projectId?: string,
  ): Promise<Panel3Output> {
    const [transitiveImpact, candidateModifies] = await Promise.all([
      filesTouched?.length
        ? this.pack.queryTransitiveImpact(filesTouched, projectId)
        : Promise.resolve([]),
      currentTaskId
        ? this.pack.queryCandidateModifies(currentTaskId, projectId)
        : Promise.resolve([]),
    ]);

    // Delta computation is basic in GTH-1 — full delta engine in GTH-3
    return {
      deltas: [],
      transitiveImpact,
      candidateModifies,
    };
  }

  // ─── Utility ────────────────────────────────────────────────────

  private derivePlanProjectId(projectId: string): string {
    // proj_c0d3e9a1f200 → plan_codegraph (convention)
    // This is a bootstrap shim — will be replaced by DomainBlueprint lookup
    const mapping: Record<string, string> = {
      proj_c0d3e9a1f200: 'plan_codegraph',
      proj_60d5feed0001: 'plan_godspeed',
      proj_0e32f3c187f4: 'plan_bible_graph',
    };
    return mapping[projectId] ?? projectId.replace('proj_', 'plan_');
  }

  async close(): Promise<void> {
    await this.neo4j.close();
    await this.pack.close?.();
  }
}
