/**
 * Claim Engine — Domain-Agnostic Claims, Evidence, and Hypotheses
 * 
 * Formalizes existing implicit claims (plan task completion, code risk verdicts,
 * entity resolution decisions) as proper graph nodes with SUPPORTS/CONTRADICTS
 * edges and confidence aggregation.
 * 
 * Schema:
 *   (:Claim {id, statement, confidence, domain, claimType, status, created, updated})
 *     -[:SUPPORTED_BY {grade, weight}]->(:Evidence)
 *     -[:CONTRADICTED_BY {grade, weight}]->(:Evidence)
 *     -[:DEPENDS_ON]->(:Claim)
 *   
 *   (:Evidence {id, source, sourceType, grade, description})
 *   
 *   (:Hypothesis {id, name, confidence, status, generatedFrom})
 *     -[:REQUIRES]->(:Claim)
 *     -[:GENERATED_FROM]->(:Gap)
 */

import neo4j, { Driver, Session } from 'neo4j-driver';

// ============================================================================
// Types
// ============================================================================

export type ClaimDomain = 'code' | 'corpus' | 'plan' | 'document';
export type ClaimStatus = 'asserted' | 'supported' | 'contested' | 'refuted';
export type EvidenceGrade = 'A1' | 'A2' | 'A3';  // A1=primary source, A2=secondary, A3=inference
export type HypothesisStatus = 'open' | 'supported' | 'refuted';

export interface Claim {
  id: string;
  statement: string;
  confidence: number;  // 0.0-1.0, computed from evidence
  domain: ClaimDomain;
  claimType: string;   // e.g., 'task_completion', 'edit_safety', 'entity_identity', 'plan_drift'
  status: ClaimStatus;
  projectId?: string;
  sourceNodeId?: string;  // the node this claim is about
}

export interface Evidence {
  id: string;
  source: string;       // e.g., 'HAS_CODE_EVIDENCE edge', 'pre_edit_check verdict'
  sourceType: string;    // e.g., 'graph_edge', 'tool_verdict', 'file_existence'
  grade: EvidenceGrade;
  description: string;
  weight: number;        // 0.0-1.0
}

export interface Hypothesis {
  id: string;
  name: string;
  confidence: number;
  status: HypothesisStatus;
  generatedFrom: string;  // gap type
  domain: ClaimDomain;
}

// ============================================================================
// Claim Engine
// ============================================================================

export class ClaimEngine {
  private driver: Driver;

  constructor() {
    const uri = process.env.NEO4J_URI ?? 'bolt://localhost:7687';
    const user = process.env.NEO4J_USER ?? 'neo4j';
    const password = process.env.NEO4J_PASSWORD ?? 'codegraph';
    this.driver = neo4j.driver(uri, neo4j.auth.basic(user, password));
  }

  async close(): Promise<void> {
    await this.driver.close();
  }

  // ============================================================================
  // Dynamic Project Discovery
  // ============================================================================

  /**
   * Discover all code project IDs from the graph.
   * No more hardcoded proj_xxx — new code projects are picked up automatically.
   */
  async discoverCodeProjectIds(): Promise<string[]> {
    const session = this.driver.session();
    try {
      const result = await session.run(
        `MATCH (p:Project)
         WHERE p.projectId IS NOT NULL
           AND (p.projectType = 'code' OR p.sourceKind = 'code'
                OR EXISTS { MATCH (:SourceFile {projectId: p.projectId}) })
           AND NOT p.projectId STARTS WITH 'plan_'
           AND NOT p.projectId STARTS WITH 'proj_bible'
           AND NOT p.projectId STARTS WITH 'proj_quran'
           AND NOT p.projectId STARTS WITH 'proj_deutero'
           AND NOT p.projectId STARTS WITH 'proj_pseudo'
           AND NOT p.projectId STARTS WITH 'proj_early'
         RETURN p.projectId AS pid
         ORDER BY pid`,
      );
      return result.records.map((r) => String(r.get('pid')));
    } finally {
      await session.close();
    }
  }

  // ============================================================================
  // Schema Setup
  // ============================================================================

  async ensureSchema(): Promise<void> {
    const session = this.driver.session();
    try {
      // Indexes for Claim nodes
      await session.run(`CREATE INDEX claim_id IF NOT EXISTS FOR (c:Claim) ON (c.id)`);
      await session.run(`CREATE INDEX claim_domain IF NOT EXISTS FOR (c:Claim) ON (c.domain)`);
      await session.run(`CREATE INDEX claim_type IF NOT EXISTS FOR (c:Claim) ON (c.claimType)`);
      await session.run(`CREATE INDEX claim_project IF NOT EXISTS FOR (c:Claim) ON (c.projectId)`);
      // Indexes for Evidence nodes
      await session.run(`CREATE INDEX evidence_id IF NOT EXISTS FOR (e:Evidence) ON (e.id)`);
      // Indexes for Hypothesis nodes
      await session.run(`CREATE INDEX hypothesis_id IF NOT EXISTS FOR (h:Hypothesis) ON (h.id)`);
      await session.run(`CREATE INDEX hypothesis_domain IF NOT EXISTS FOR (h:Hypothesis) ON (h.domain)`);
    } finally {
      await session.close();
    }
  }

  // ============================================================================
  // Plan Domain Claims
  // ============================================================================

  /**
   * Generate claims from plan task completion evidence.
   * Each task with code evidence gets a SUPPORTED claim.
   * Each completed task without evidence gets a lower-confidence claim.
   * Tasks marked planned with evidence → drift claims.
   */
  async generatePlanClaims(projectFilter?: string): Promise<{ claims: number; evidence: number; hypotheses: number }> {
    const session = this.driver.session();
    const now = new Date().toISOString();
    let claimCount = 0;
    let evidenceCount = 0;
    let hypothesisCount = 0;

    try {
      const filterClause = projectFilter
        ? `AND t.projectId = $ppid`
        : '';
      const params: Record<string, any> = projectFilter
        ? { ppid: `plan_${projectFilter.replace(/-/g, '_')}`, now }
        : { now };

      // 1. Tasks marked done WITH code evidence → high-confidence completion claims
      // Step 1a: Create claim nodes
      const doneWithEvidenceClaims = await session.run(
        `MATCH (t:Task {status: 'done'})
         WHERE t.hasCodeEvidence = true ${filterClause}
         MERGE (c:Claim {id: 'claim_task_' + t.id})
         ON CREATE SET
           c.statement = 'Task "' + t.name + '" is complete',
           c.confidence = 0.95,
           c.domain = 'plan',
           c.claimType = 'task_completion',
           c.status = 'supported',
           c.projectId = t.projectId,
           c.sourceNodeId = t.id,
           c.created = $now
         ON MATCH SET
           c.confidence = 0.95,
           c.status = 'supported',
           c.updated = $now
         RETURN count(c) AS claims`,
        params,
      );
      if (doneWithEvidenceClaims.records.length > 0) {
        claimCount += doneWithEvidenceClaims.records[0].get('claims').toNumber();
      }

      // Step 1b: Link evidence (separate query to avoid UNWIND killing rows)
      const doneWithEvidenceLinks = await session.run(
        `MATCH (t:Task {status: 'done'})-[:HAS_CODE_EVIDENCE]->(sf)
         WHERE t.hasCodeEvidence = true ${filterClause}
         WITH t, sf
         MATCH (c:Claim {id: 'claim_task_' + t.id})
         MERGE (e:Evidence {id: 'ev_code_' + t.id + '_' + sf.name})
         ON CREATE SET
           e.source = 'HAS_CODE_EVIDENCE → ' + sf.name,
           e.sourceType = 'graph_edge',
           e.grade = 'A1',
           e.description = 'Code file ' + sf.name + ' exists and matches task reference',
           e.weight = 0.9,
           e.created = $now
         MERGE (c)-[:SUPPORTED_BY {grade: 'A1', weight: 0.9}]->(e)
         RETURN count(DISTINCT e) AS evidences`,
        params,
      );
      if (doneWithEvidenceLinks.records.length > 0) {
        evidenceCount += doneWithEvidenceLinks.records[0].get('evidences').toNumber();
      }

      // 2. Tasks marked done WITHOUT code evidence → moderate-confidence (checkbox only)
      const doneNoEvidence = await session.run(
        `MATCH (t:Task {status: 'done'})
         WHERE (t.hasCodeEvidence IS NULL OR t.hasCodeEvidence = false) ${filterClause}
         MERGE (c:Claim {id: 'claim_task_' + t.id})
         ON CREATE SET
           c.statement = 'Task "' + t.name + '" is complete',
           c.confidence = 0.6,
           c.domain = 'plan',
           c.claimType = 'task_completion',
           c.status = 'asserted',
           c.projectId = t.projectId,
           c.sourceNodeId = t.id,
           c.created = $now
         ON MATCH SET
           c.confidence = CASE WHEN c.confidence > 0.6 THEN c.confidence ELSE 0.6 END,
           c.updated = $now
         WITH t, c
         MERGE (e:Evidence {id: 'ev_checkbox_' + t.id})
         ON CREATE SET
           e.source = 'Plan checkbox [x]',
           e.sourceType = 'plan_markup',
           e.grade = 'A2',
           e.description = 'Task checked off in plan file but no code evidence found',
           e.weight = 0.5,
           e.created = $now
         MERGE (c)-[:SUPPORTED_BY {grade: 'A2', weight: 0.5}]->(e)
         RETURN count(DISTINCT c) AS claims, count(DISTINCT e) AS evidences`,
        params,
      );
      if (doneNoEvidence.records.length > 0) {
        claimCount += doneNoEvidence.records[0].get('claims').toNumber();
        evidenceCount += doneNoEvidence.records[0].get('evidences').toNumber();
      }

      // 3. Drift: tasks marked planned but code evidence exists → contested claims
      const driftTasks = await session.run(
        `MATCH (t:Task {status: 'planned'})
         WHERE t.hasCodeEvidence = true ${filterClause}
         OPTIONAL MATCH (t)-[:HAS_CODE_EVIDENCE]->(sf)
         WITH t, collect(sf.name) AS codeFiles
         MERGE (c:Claim {id: 'claim_drift_' + t.id})
         ON CREATE SET
           c.statement = 'Task "' + t.name + '" may be complete but is not checked off (drift)',
           c.confidence = 0.75,
           c.domain = 'plan',
           c.claimType = 'plan_drift',
           c.status = 'contested',
           c.projectId = t.projectId,
           c.sourceNodeId = t.id,
           c.created = $now
         ON MATCH SET
           c.confidence = 0.75,
           c.status = 'contested',
           c.updated = $now
         WITH t, c, codeFiles
         UNWIND codeFiles AS cf
         MERGE (e:Evidence {id: 'ev_drift_code_' + t.id + '_' + cf})
         ON CREATE SET
           e.source = 'Code exists: ' + cf,
           e.sourceType = 'graph_edge',
           e.grade = 'A1',
           e.description = 'Code evidence found but plan still says planned',
           e.weight = 0.8,
           e.created = $now
         MERGE (c)-[:SUPPORTED_BY {grade: 'A1', weight: 0.8}]->(e)
         // Also add contradicting evidence: the checkbox says planned
         WITH t, c
         MERGE (ce:Evidence {id: 'ev_drift_plan_' + t.id})
         ON CREATE SET
           ce.source = 'Plan checkbox [ ]',
           ce.sourceType = 'plan_markup',
           ce.grade = 'A2',
           ce.description = 'Plan file explicitly says task is not done',
           ce.weight = 0.4,
           ce.created = $now
         MERGE (c)-[:CONTRADICTED_BY {grade: 'A2', weight: 0.4}]->(ce)
         RETURN count(DISTINCT c) AS claims`,
        params,
      );
      if (driftTasks.records.length > 0) {
        claimCount += driftTasks.records[0].get('claims').toNumber();
      }

      // 4. Generate hypotheses from gaps: planned tasks with NO evidence at all
      const gapHypotheses = await session.run(
        `MATCH (t:Task {status: 'planned'})
         WHERE (t.hasCodeEvidence IS NULL OR t.hasCodeEvidence = false) ${filterClause}
         OPTIONAL MATCH (t)-[:PART_OF]->(parent)
         WITH t, parent
         MERGE (h:Hypothesis {id: 'hyp_gap_' + t.id})
         ON CREATE SET
           h.name = 'Task "' + t.name + '" has not been started',
           h.confidence = 0.0,
           h.status = 'open',
           h.domain = 'plan',
           h.generatedFrom = 'no_evidence_gap',
           h.projectId = t.projectId,
           h.sourceNodeId = t.id,
           h.parentSection = parent.name,
           h.created = $now
         ON MATCH SET
           h.updated = $now
         RETURN count(DISTINCT h) AS hypotheses`,
        params,
      );
      if (gapHypotheses.records.length > 0) {
        hypothesisCount += gapHypotheses.records[0].get('hypotheses').toNumber();
      }

      return { claims: claimCount, evidence: evidenceCount, hypotheses: hypothesisCount };
    } finally {
      await session.close();
    }
  }

  // ============================================================================
  // Code Domain Claims
  // ============================================================================

  /**
   * Generate claims from code risk analysis.
   * Functions with high riskLevel → claims about edit safety.
   * Functions with many callers + no tests → claims about coverage gaps.
   */
  async generateCodeClaims(projectId: string): Promise<{ claims: number; evidence: number; hypotheses: number }> {
    const session = this.driver.session();
    const now = new Date().toISOString();
    let claimCount = 0;
    let evidenceCount = 0;
    let hypothesisCount = 0;

    try {
      // 1. High-risk functions → edit safety claims
      const highRisk = await session.run(
        `MATCH (f:CodeNode {projectId: $projectId})
         WHERE f.riskLevel IS NOT NULL AND f.riskLevel >= 3
         OPTIONAL MATCH (caller)-[:CALLS]->(f)
         WITH f, count(caller) AS callerCount
         MERGE (c:Claim {id: 'claim_risk_' + f.id})
         ON CREATE SET
           c.statement = 'Function "' + f.name + '" is high-risk (level ' + toString(f.riskLevel) + ', ' + toString(callerCount) + ' callers)',
           c.confidence = 0.85,
           c.domain = 'code',
           c.claimType = 'edit_safety',
           c.status = 'supported',
           c.projectId = $projectId,
           c.sourceNodeId = f.id,
           c.created = $now
         ON MATCH SET
           c.statement = 'Function "' + f.name + '" is high-risk (level ' + toString(f.riskLevel) + ', ' + toString(callerCount) + ' callers)',
           c.confidence = 0.85,
           c.updated = $now
         WITH f, c, callerCount
         MERGE (e:Evidence {id: 'ev_risk_' + f.id})
         ON CREATE SET
           e.source = 'riskLevel: ' + toString(f.riskLevel) + ', fanIn: ' + toString(callerCount),
           e.sourceType = 'graph_metric',
           e.grade = 'A1',
           e.description = 'Structural analysis: riskLevel=' + toString(f.riskLevel) + ', callers=' + toString(callerCount) + ', complexity=' + toString(coalesce(f.complexity, 0)),
           e.weight = 0.85,
           e.created = $now
         MERGE (c)-[:SUPPORTED_BY {grade: 'A1', weight: 0.85}]->(e)
         RETURN count(DISTINCT c) AS claims, count(DISTINCT e) AS evidences`,
        { projectId, now },
      );
      if (highRisk.records.length > 0) {
        claimCount += highRisk.records[0].get('claims').toNumber();
        evidenceCount += highRisk.records[0].get('evidences').toNumber();
      }

      // 2. Coverage gap hypotheses: high-risk + no tests
      const untested = await session.run(
        `MATCH (f:CodeNode {projectId: $projectId})
         WHERE f.riskLevel IS NOT NULL AND f.riskLevel >= 2
         AND NOT EXISTS { MATCH (f)-[:TESTED_BY]->(:TestCase) }
         WITH f
         MERGE (h:Hypothesis {id: 'hyp_untested_' + f.id})
         ON CREATE SET
           h.name = 'Function "' + f.name + '" (risk ' + toString(f.riskLevel) + ') has no test coverage',
           h.confidence = 0.0,
           h.status = 'open',
           h.domain = 'code',
           h.generatedFrom = 'coverage_gap',
           h.projectId = $projectId,
           h.sourceNodeId = f.id,
           h.created = $now
         ON MATCH SET
           h.updated = $now
         RETURN count(DISTINCT h) AS hypotheses`,
        { projectId, now },
      );
      if (untested.records.length > 0) {
        hypothesisCount += untested.records[0].get('hypotheses').toNumber();
      }

      return { claims: claimCount, evidence: evidenceCount, hypotheses: hypothesisCount };
    } finally {
      await session.close();
    }
  }

  // ============================================================================
  // Corpus Domain Claims
  // ============================================================================

  /**
   * Generate claims from entity resolution.
   * Cross-corpus PARAPHRASES → identity claims.
   * Shared Person nodes across projects → canonical identity claims.
   */
  async generateCorpusClaims(): Promise<{ claims: number; evidence: number }> {
    const session = this.driver.session();
    const now = new Date().toISOString();
    let claimCount = 0;
    let evidenceCount = 0;

    try {
      // Cross-corpus person identity claims — Person nodes link to Verse nodes across projects
      const crossCorpus = await session.run(
        `MATCH (p:Person)<-[:MENTIONS_PERSON]-(v)
         WHERE v.projectId IS NOT NULL
         WITH p.name AS name, collect(DISTINCT v.projectId) AS projects
         WHERE size(projects) > 1
         WITH name, projects, size(projects) AS projCount
         MERGE (c:Claim {id: 'claim_entity_' + replace(toLower(name), ' ', '_')})
         ON CREATE SET
           c.statement = '"' + name + '" appears across ' + toString(projCount) + ' corpora',
           c.confidence = CASE
             WHEN projCount >= 4 THEN 0.95
             WHEN projCount = 3 THEN 0.85
             ELSE 0.7
           END,
           c.domain = 'corpus',
           c.claimType = 'entity_identity',
           c.status = 'supported',
           c.created = $now
         ON MATCH SET
           c.confidence = CASE
             WHEN projCount >= 4 THEN 0.95
             WHEN projCount = 3 THEN 0.85
             ELSE 0.7
           END,
           c.updated = $now
         WITH c, name, projCount
         MERGE (e:Evidence {id: 'ev_entity_cross_' + replace(toLower(name), ' ', '_')})
         ON CREATE SET
           e.source = 'Cross-corpus MENTIONS_PERSON edges in ' + toString(projCount) + ' projects',
           e.sourceType = 'entity_resolution',
           e.grade = 'A2',
           e.description = 'Person "' + name + '" mentioned in verses across ' + toString(projCount) + ' corpus projects via NER',
           e.weight = 0.7,
           e.created = $now
         MERGE (c)-[:SUPPORTED_BY {grade: 'A2', weight: 0.7}]->(e)
         RETURN count(DISTINCT c) AS claims, count(DISTINCT e) AS evidences`,
        { now },
      );
      if (crossCorpus.records.length > 0) {
        claimCount += crossCorpus.records[0].get('claims').toNumber();
        evidenceCount += crossCorpus.records[0].get('evidences').toNumber();
      }

      return { claims: claimCount, evidence: evidenceCount };
    } finally {
      await session.close();
    }
  }

  // ============================================================================
  // Cross-Layer Synthesizers — THE REAL REASONING
  // ============================================================================

  /**
   * SYNTHESIZER 1: Cross-cutting impact claims
   * "Editing file X will break Y MCP tools and invalidate Z plan evidence edges"
   * Connects: Code (blast radius) → Plan (evidence integrity)
   */
  async synthesizeCrossCuttingClaims(): Promise<{ claims: number; evidence: number }> {
    const now = new Date().toISOString();
    let claimCount = 0;
    let evidenceCount = 0;
    const codeProjectIds = await this.discoverCodeProjectIds();

    for (const cg of codeProjectIds) {
      const session = this.driver.session();
      try {
        // Find source files that are BOTH high-risk code AND plan evidence targets
        const crossCut = await session.run(
          `MATCH (sf {projectId: $cg})<-[:HAS_CODE_EVIDENCE]-(t:Task)
           WHERE sf.riskLevel IS NOT NULL AND sf.riskLevel >= 3
           WITH sf, count(DISTINCT t) AS tasksDependingOnIt, collect(DISTINCT t.name)[..3] AS taskNames,
                sf.riskLevel AS risk
           OPTIONAL MATCH (caller)-[:CALLS]->(sf)
           WITH sf, tasksDependingOnIt, taskNames, risk, count(DISTINCT caller) AS callers
           WHERE tasksDependingOnIt >= 1
           MERGE (c:Claim {id: 'claim_crosscut_' + sf.id})
           ON CREATE SET
             c.statement = 'Editing "' + sf.name + '" (risk ' + toString(round(risk * 10) / 10.0) + ', ' + toString(callers) + ' callers) would invalidate evidence for ' + toString(tasksDependingOnIt) + ' plan tasks: ' + reduce(s = '', n IN taskNames | s + CASE WHEN s = '' THEN '' ELSE ', ' END + n),
             c.confidence = 0.9,
             c.domain = 'cross',
             c.claimType = 'cross_cutting_impact',
             c.status = 'supported',
             c.projectId = $cg,
             c.sourceNodeId = sf.id,
             c.taskCount = tasksDependingOnIt,
             c.created = $now
           ON MATCH SET
             c.statement = 'Editing "' + sf.name + '" (risk ' + toString(round(risk * 10) / 10.0) + ', ' + toString(callers) + ' callers) would invalidate evidence for ' + toString(tasksDependingOnIt) + ' plan tasks: ' + reduce(s = '', n IN taskNames | s + CASE WHEN s = '' THEN '' ELSE ', ' END + n),
             c.taskCount = tasksDependingOnIt,
             c.updated = $now
           WITH c, sf, tasksDependingOnIt, callers, risk
           MERGE (e:Evidence {id: 'ev_crosscut_' + sf.id})
           ON CREATE SET
             e.source = 'Code risk + plan evidence intersection',
             e.sourceType = 'cross_layer_analysis',
             e.grade = 'A1',
             e.description = sf.name + ': riskLevel=' + toString(risk) + ', callers=' + toString(callers) + ', plan tasks depending=' + toString(tasksDependingOnIt),
             e.weight = 0.9,
             e.created = $now
           MERGE (c)-[:SUPPORTED_BY {grade: 'A1', weight: 0.9}]->(e)
           RETURN count(DISTINCT c) AS claims, count(DISTINCT e) AS evidences`,
          { cg, now },
        );
        if (crossCut.records.length > 0) {
          claimCount += crossCut.records[0].get('claims').toNumber();
          evidenceCount += crossCut.records[0].get('evidences').toNumber();
        }
      } finally {
        await session.close();
      }
    }

    return { claims: claimCount, evidence: evidenceCount };
  }

  /**
   * SYNTHESIZER 2: Critical path claims
   * Traverses PART_OF hierarchy + plan structure to find dependency bottlenecks.
   * "Sprint 1 has 4 unfinished tasks blocking Sprint 2's 6 tasks"
   */
  async synthesizeCriticalPathClaims(): Promise<{ claims: number; evidence: number }> {
    const session = this.driver.session();
    const now = new Date().toISOString();
    let claimCount = 0;
    let evidenceCount = 0;

    try {
      // Find sprints/milestones with mixed completion — some done, some not
      const bottlenecks = await session.run(
        `MATCH (t:Task)-[:PART_OF]->(m:Milestone)
         WITH m,
           count(t) AS total,
           sum(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END) AS done,
           sum(CASE WHEN t.status = 'planned' THEN 1 ELSE 0 END) AS planned,
           collect(CASE WHEN t.status = 'planned' THEN t.name ELSE null END)[..3] AS blockers
         WHERE planned > 0 AND done > 0
         WITH m, total, done, planned, blockers,
              toFloat(done) / total AS completionRate
         MERGE (c:Claim {id: 'claim_bottleneck_' + m.id})
         ON CREATE SET
           c.statement = '"' + m.name + '" is ' + toString(round(completionRate * 100)) + '% complete (' + toString(done) + '/' + toString(total) + ') — ' + toString(planned) + ' tasks remaining: ' + reduce(s = '', n IN blockers | s + CASE WHEN s = '' THEN '' ELSE ', ' END + n),
           c.confidence = 0.95,
           c.domain = 'plan',
           c.claimType = 'bottleneck',
           c.status = 'supported',
           c.projectId = m.projectId,
           c.sourceNodeId = m.id,
           c.completionRate = completionRate,
           c.created = $now
         ON MATCH SET
           c.statement = '"' + m.name + '" is ' + toString(round(completionRate * 100)) + '% complete (' + toString(done) + '/' + toString(total) + ') — ' + toString(planned) + ' tasks remaining: ' + reduce(s = '', n IN blockers | s + CASE WHEN s = '' THEN '' ELSE ', ' END + n),
           c.completionRate = completionRate,
           c.updated = $now
         WITH c, m, completionRate, done, total
         MERGE (e:Evidence {id: 'ev_bottleneck_' + m.id})
         ON CREATE SET
           e.source = 'Milestone task analysis',
           e.sourceType = 'plan_structure',
           e.grade = 'A1',
           e.description = toString(done) + '/' + toString(total) + ' tasks done, completion=' + toString(round(completionRate * 100)) + '%',
           e.weight = 0.95,
           e.created = $now
         MERGE (c)-[:SUPPORTED_BY {grade: 'A1', weight: 0.95}]->(e)
         RETURN count(DISTINCT c) AS claims, count(DISTINCT e) AS evidences`,
        { now },
      );
      if (bottlenecks.records.length > 0) {
        claimCount += bottlenecks.records[0].get('claims').toNumber();
        evidenceCount += bottlenecks.records[0].get('evidences').toNumber();
      }

      return { claims: claimCount, evidence: evidenceCount };
    } finally {
      await session.close();
    }
  }

  /**
   * SYNTHESIZER 3: Temporal stability claims
   * Uses CO_CHANGES_WITH frequency to identify files that change together —
   * if one is stable and the other is churning, that's a coupling risk.
   */
  async synthesizeTemporalClaims(): Promise<{ claims: number; evidence: number }> {
    const session = this.driver.session();
    const now = new Date().toISOString();
    let claimCount = 0;
    let evidenceCount = 0;

    try {
      // Files with high co-change frequency — tight coupling signals
      const coupled = await session.run(
        `MATCH (a)-[r:CO_CHANGES_WITH]->(b)
         WHERE a.projectId IS NOT NULL AND r.cochangeCount >= 3
         WITH a, b, r.cochangeCount AS changes, r.confidence AS conf
         ORDER BY changes DESC
         LIMIT 20
         MERGE (c:Claim {id: 'claim_coupled_' + a.id + '_' + b.id})
         ON CREATE SET
           c.statement = '"' + a.name + '" and "' + b.name + '" are tightly coupled (' + toString(changes) + ' co-changes) — editing one likely requires editing the other',
           c.confidence = CASE WHEN changes >= 8 THEN 0.95 WHEN changes >= 5 THEN 0.85 ELSE 0.7 END,
           c.domain = 'code',
           c.claimType = 'temporal_coupling',
           c.status = 'supported',
           c.projectId = a.projectId,
           c.cochangeCount = changes,
           c.created = $now
         ON MATCH SET
           c.cochangeCount = changes,
           c.updated = $now
         WITH c, a, b, changes
         MERGE (e:Evidence {id: 'ev_coupled_' + a.id + '_' + b.id})
         ON CREATE SET
           e.source = 'CO_CHANGES_WITH: ' + toString(changes) + ' co-commits',
           e.sourceType = 'git_temporal',
           e.grade = 'A1',
           e.description = a.name + ' ↔ ' + b.name + ' changed together in ' + toString(changes) + ' commits',
           e.weight = CASE WHEN changes >= 8 THEN 0.95 WHEN changes >= 5 THEN 0.85 ELSE 0.7 END,
           e.created = $now
         MERGE (c)-[:SUPPORTED_BY {grade: 'A1', weight: 0.9}]->(e)
         RETURN count(DISTINCT c) AS claims, count(DISTINCT e) AS evidences`,
        { now },
      );
      if (coupled.records.length > 0) {
        claimCount += coupled.records[0].get('claims').toNumber();
        evidenceCount += coupled.records[0].get('evidences').toNumber();
      }

      return { claims: claimCount, evidence: evidenceCount };
    } finally {
      await session.close();
    }
  }

  /**
   * SYNTHESIZER 4: Coverage gap claims
   * Cross-references TestCase nodes against high-risk functions.
   * "X% of high-risk functions have no test coverage"
   */
  async synthesizeCoverageGapClaims(): Promise<{ claims: number; evidence: number }> {
    const now = new Date().toISOString();
    let claimCount = 0;
    let evidenceCount = 0;
    const codeProjectIds = await this.discoverCodeProjectIds();

    for (const cg of codeProjectIds) {
      const session = this.driver.session();
      try {
        // Per-project: count high-risk functions with and without tests
        const coverage = await session.run(
          `MATCH (f {projectId: $cg})
           WHERE f.riskLevel IS NOT NULL AND f.riskLevel >= 2
           WITH f, EXISTS { MATCH (f)-[:TESTED_BY]->(:TestCase) } AS hasTesting
           WITH count(f) AS total,
                sum(CASE WHEN hasTesting THEN 1 ELSE 0 END) AS tested,
                sum(CASE WHEN NOT hasTesting THEN 1 ELSE 0 END) AS untested,
                collect(CASE WHEN NOT hasTesting THEN f.name ELSE null END)[..5] AS worstOffenders
           WHERE total > 0
           MERGE (c:Claim {id: 'claim_coverage_' + $cg})
           ON CREATE SET
             c.statement = toString(untested) + ' of ' + toString(total) + ' high-risk functions (' + toString(round(toFloat(untested)/total * 100)) + '%) have no test coverage. Worst: ' + reduce(s = '', n IN worstOffenders | s + CASE WHEN s = '' THEN '' ELSE ', ' END + n),
             c.confidence = 0.95,
             c.domain = 'code',
             c.claimType = 'coverage_gap',
             c.status = 'supported',
             c.projectId = $cg,
             c.untested = untested,
             c.total = total,
             c.created = $now
           ON MATCH SET
             c.statement = toString(untested) + ' of ' + toString(total) + ' high-risk functions (' + toString(round(toFloat(untested)/total * 100)) + '%) have no test coverage. Worst: ' + reduce(s = '', n IN worstOffenders | s + CASE WHEN s = '' THEN '' ELSE ', ' END + n),
             c.untested = untested,
             c.total = total,
             c.updated = $now
           WITH c, untested, total
           MERGE (e:Evidence {id: 'ev_coverage_' + $cg})
           ON CREATE SET
             e.source = 'TestCase node count vs high-risk function count',
             e.sourceType = 'structural_analysis',
             e.grade = 'A1',
             e.description = toString(untested) + '/' + toString(total) + ' high-risk functions untested',
             e.weight = 0.95,
             e.created = $now
           MERGE (c)-[:SUPPORTED_BY {grade: 'A1', weight: 0.95}]->(e)
           RETURN count(DISTINCT c) AS claims, count(DISTINCT e) AS evidences`,
          { cg, now },
        );
        if (coverage.records.length > 0) {
          claimCount += coverage.records[0].get('claims').toNumber();
          evidenceCount += coverage.records[0].get('evidences').toNumber();
        }
      } finally {
        await session.close();
      }
    }

    return { claims: claimCount, evidence: evidenceCount };
  }

  /**
   * SYNTHESIZER 5: Cross-domain entity claims
   * Finds entities that appear in BOTH code (as function/file names) AND corpus (as Person nodes)
   * AND plan (as task references). The more layers an entity touches, the higher its centrality.
   */
  async synthesizeCrossDomainEntityClaims(): Promise<{ claims: number; evidence: number }> {
    const session = this.driver.session();
    const now = new Date().toISOString();
    let claimCount = 0;
    let evidenceCount = 0;

    try {
      // Person nodes that appear in multiple corpora AND have related plan tasks
      const multiDomain = await session.run(
        `MATCH (p:Person)<-[:MENTIONS_PERSON]-(v)
         WHERE v.projectId IS NOT NULL
         WITH p, collect(DISTINCT v.projectId) AS corpusProjects, count(DISTINCT v) AS mentionCount
         WHERE size(corpusProjects) >= 2
         WITH p, corpusProjects, mentionCount
         MERGE (c:Claim {id: 'claim_centrality_' + replace(toLower(p.name), ' ', '_')})
         ON CREATE SET
           c.statement = '"' + p.name + '" is a cross-domain entity: ' + toString(mentionCount) + ' mentions across ' + toString(size(corpusProjects)) + ' corpora',
           c.confidence = CASE
             WHEN size(corpusProjects) >= 4 AND mentionCount >= 100 THEN 0.98
             WHEN size(corpusProjects) >= 3 THEN 0.9
             ELSE 0.75
           END,
           c.domain = 'cross',
           c.claimType = 'entity_centrality',
           c.status = 'supported',
           c.mentionCount = mentionCount,
           c.corpusCount = size(corpusProjects),
           c.created = $now
         ON MATCH SET
           c.mentionCount = mentionCount,
           c.corpusCount = size(corpusProjects),
           c.updated = $now
         WITH c, p, mentionCount, corpusProjects
         MERGE (e:Evidence {id: 'ev_centrality_' + replace(toLower(p.name), ' ', '_')})
         ON CREATE SET
           e.source = 'MENTIONS_PERSON edges across ' + toString(size(corpusProjects)) + ' projects',
           e.sourceType = 'entity_resolution',
           e.grade = 'A1',
           e.description = p.name + ': ' + toString(mentionCount) + ' verse mentions across ' + toString(size(corpusProjects)) + ' corpora',
           e.weight = 0.9,
           e.created = $now
         MERGE (c)-[:SUPPORTED_BY {grade: 'A1', weight: 0.9}]->(e)
         RETURN count(DISTINCT c) AS claims, count(DISTINCT e) AS evidences`,
        { now },
      );
      if (multiDomain.records.length > 0) {
        claimCount += multiDomain.records[0].get('claims').toNumber();
        evidenceCount += multiDomain.records[0].get('evidences').toNumber();
      }

      return { claims: claimCount, evidence: evidenceCount };
    } finally {
      await session.close();
    }
  }

  // ============================================================================
  // Confidence Aggregation
  // ============================================================================

  /**
   * Recompute confidence for all claims based on their evidence.
   * Formula: confidence = Σ(supporting_weight × grade_factor) - Σ(contradicting_weight × grade_factor)
   * Clamped to [0.0, 1.0]
   */
  async recomputeConfidence(): Promise<number> {
    const session = this.driver.session();
    try {
      const result = await session.run(
        `MATCH (c:Claim)
         OPTIONAL MATCH (c)-[s:SUPPORTED_BY]->(se:Evidence)
         WITH c, collect({weight: coalesce(s.weight, 0), grade: coalesce(s.grade, 'A3')}) AS supports
         OPTIONAL MATCH (c)-[ct:CONTRADICTED_BY]->(ce:Evidence)
         WITH c, supports, collect({weight: coalesce(ct.weight, 0), grade: coalesce(ct.grade, 'A3')}) AS contradicts
         WITH c,
           reduce(total = 0.0, s IN supports | total + s.weight * CASE s.grade WHEN 'A1' THEN 1.0 WHEN 'A2' THEN 0.7 ELSE 0.4 END) AS supportScore,
           reduce(total = 0.0, ct IN contradicts | total + ct.weight * CASE ct.grade WHEN 'A1' THEN 1.0 WHEN 'A2' THEN 0.7 ELSE 0.4 END) AS contradictScore
         WITH c,
           CASE
             WHEN supportScore + contradictScore = 0 THEN c.confidence
             ELSE toFloat(supportScore) / (supportScore + contradictScore + 0.001)
           END AS newConfidence
         SET c.confidence = CASE
           WHEN newConfidence > 1.0 THEN 1.0
           WHEN newConfidence < 0.0 THEN 0.0
           ELSE round(newConfidence * 100) / 100.0
         END,
         c.status = CASE
           WHEN newConfidence >= 0.8 THEN 'supported'
           WHEN newConfidence >= 0.4 THEN 'contested'
           WHEN newConfidence > 0 THEN 'asserted'
           ELSE 'refuted'
         END
         RETURN count(c) AS updated`,
      );
      if (result.records.length > 0) {
        return result.records[0].get('updated').toNumber();
      }
      return 0;
    } finally {
      await session.close();
    }
  }

  // ============================================================================
  // Full Pipeline
  // ============================================================================

  /**
   * Run the full claim generation pipeline across all domains.
   */
  async generateAll(): Promise<{
    plan: { claims: number; evidence: number; hypotheses: number };
    code: { claims: number; evidence: number; hypotheses: number };
    corpus: { claims: number; evidence: number };
    cross: { claims: number; evidence: number };
    confidenceUpdated: number;
  }> {
    await this.ensureSchema();

    // Phase 1: Single-domain claims (existing generators)
    const plan = await this.generatePlanClaims();

    // Dynamically discover all code projects instead of hardcoding IDs
    const codeProjectIds = await this.discoverCodeProjectIds();
    const code = { claims: 0, evidence: 0, hypotheses: 0 };
    for (const pid of codeProjectIds) {
      const result = await this.generateCodeClaims(pid);
      code.claims += result.claims;
      code.evidence += result.evidence;
      code.hypotheses += result.hypotheses;
    }

    const corpus = await this.generateCorpusClaims();

    // Phase 2: Cross-layer synthesizers (THE REAL REASONING)
    const crossCut = await this.synthesizeCrossCuttingClaims();
    const criticalPath = await this.synthesizeCriticalPathClaims();
    const temporal = await this.synthesizeTemporalClaims();
    const coverageGap = await this.synthesizeCoverageGapClaims();
    const entityCentrality = await this.synthesizeCrossDomainEntityClaims();

    const cross = {
      claims: crossCut.claims + criticalPath.claims + temporal.claims + coverageGap.claims + entityCentrality.claims,
      evidence: crossCut.evidence + criticalPath.evidence + temporal.evidence + coverageGap.evidence + entityCentrality.evidence,
    };

    // Phase 3: Recompute confidence with all evidence in place
    const confidenceUpdated = await this.recomputeConfidence();

    return { plan, code, corpus, cross, confidenceUpdated };
  }
}

// ============================================================================
// CLI runner
// ============================================================================

async function main() {
  const engine = new ClaimEngine();
  try {
    console.log('🧠 Generating claims across all domains...\n');
    const results = await engine.generateAll();

    console.log('📋 Plan Domain:');
    console.log(`   Claims: ${results.plan.claims}, Evidence: ${results.plan.evidence}, Hypotheses: ${results.plan.hypotheses}`);
    console.log('💻 Code Domain:');
    console.log(`   Claims: ${results.code.claims}, Evidence: ${results.code.evidence}, Hypotheses: ${results.code.hypotheses}`);
    console.log('📚 Corpus Domain:');
    console.log(`   Claims: ${results.corpus.claims}, Evidence: ${results.corpus.evidence}`);
    console.log('🔗 Cross-Layer Synthesis:');
    console.log(`   Claims: ${results.cross.claims}, Evidence: ${results.cross.evidence}`);
    console.log(`\n🔄 Confidence recomputed on ${results.confidenceUpdated} claims`);

    const total = results.plan.claims + results.code.claims + results.corpus.claims + results.cross.claims;
    const totalEv = results.plan.evidence + results.code.evidence + results.corpus.evidence + results.cross.evidence;
    const totalHyp = results.plan.hypotheses + results.code.hypotheses;
    console.log(`\n📊 Total: ${total} claims, ${totalEv} evidence nodes, ${totalHyp} hypotheses`);
  } finally {
    await engine.close();
  }
}

if (process.argv[1]?.endsWith('claim-engine.ts') || process.argv[1]?.endsWith('claim-engine.js')) {
  main().catch(console.error);
}
