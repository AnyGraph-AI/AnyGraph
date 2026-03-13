import { Neo4jService } from '../../storage/neo4j/neo4j.service.js';

export interface RuntimeGateEvidenceInput {
  projectId: string;
  verificationRun: {
    runId: string;
    ranAt: string;
    tool: string;
    toolVersion?: string;
    ok: boolean;
    durationMs: number;
    artifactHash?: string;
    decisionHash: string;
  };
  gateDecision: {
    gateName: string;
    result: 'pass' | 'fail' | 'warn';
    evaluatedAt: string;
    policyBundleId: string;
    externalContextSnapshotRef: string;
    decisionHash: string;
  };
  commitSnapshot: {
    headSha: string;
    branch: string;
    capturedAt: string;
  };
  workingTreeSnapshot: {
    isDirty: boolean;
    diffHash: string;
    capturedAt: string;
  };
  artifact?: {
    path: string;
    sha256: string;
    createdAt: string;
  };
}

export interface RuntimeGateEvidenceResult {
  runNodeUpserted: number;
  gateDecisionNodeUpserted: number;
  commitSnapshotNodeUpserted: number;
  workingTreeSnapshotNodeUpserted: number;
  artifactNodeUpserted: number;
  edgesCreated: number;
}

export async function ingestRuntimeGateEvidence(
  input: RuntimeGateEvidenceInput,
): Promise<RuntimeGateEvidenceResult> {
  const neo4j = new Neo4jService();

  const runId = input.verificationRun.runId;
  const gateDecisionId = `gate:${runId}:${input.gateDecision.gateName}`;
  const commitSnapshotId = `commit-snapshot:${runId}`;
  const workingTreeSnapshotId = `worktree-snapshot:${runId}`;
  const artifactId = input.artifact ? `artifact:${input.artifact.sha256.slice(0, 32)}` : null;

  let edgesCreated = 0;

  try {
    await neo4j.run(
      `MERGE (r:CodeNode:VerificationRun {id: $runId})
       SET r.projectId = $projectId,
           r.coreType = 'VerificationRun',
           r.runId = $runId,
           r.ranAt = $ranAt,
           r.tool = $tool,
           r.toolVersion = $toolVersion,
           r.ok = $ok,
           r.durationMs = $durationMs,
           r.artifactHash = $artifactHash,
           r.decisionHash = $decisionHash,
           r.status = CASE WHEN $ok THEN 'satisfies' ELSE 'violates' END,
           r.updatedAt = toString(datetime())`,
      {
        projectId: input.projectId,
        runId,
        ranAt: input.verificationRun.ranAt,
        tool: input.verificationRun.tool,
        toolVersion: input.verificationRun.toolVersion,
        ok: input.verificationRun.ok,
        durationMs: input.verificationRun.durationMs,
        artifactHash: input.verificationRun.artifactHash,
        decisionHash: input.verificationRun.decisionHash,
      },
    );

    await neo4j.run(
      `MERGE (g:CodeNode:GateDecision {id: $gateDecisionId})
       SET g.projectId = $projectId,
           g.coreType = 'GateDecision',
           g.gateName = $gateName,
           g.result = $result,
           g.evaluatedAt = $evaluatedAt,
           g.policyBundleId = $policyBundleId,
           g.externalContextSnapshotRef = $externalContextSnapshotRef,
           g.decisionHash = $decisionHash,
           g.updatedAt = toString(datetime())`,
      {
        projectId: input.projectId,
        gateDecisionId,
        gateName: input.gateDecision.gateName,
        result: input.gateDecision.result,
        evaluatedAt: input.gateDecision.evaluatedAt,
        policyBundleId: input.gateDecision.policyBundleId,
        externalContextSnapshotRef: input.gateDecision.externalContextSnapshotRef,
        decisionHash: input.gateDecision.decisionHash,
      },
    );

    await neo4j.run(
      `MERGE (c:CodeNode:CommitSnapshot {id: $commitSnapshotId})
       SET c.projectId = $projectId,
           c.coreType = 'CommitSnapshot',
           c.headSha = $headSha,
           c.branch = $branch,
           c.capturedAt = $capturedAt,
           c.updatedAt = toString(datetime())`,
      {
        projectId: input.projectId,
        commitSnapshotId,
        headSha: input.commitSnapshot.headSha,
        branch: input.commitSnapshot.branch,
        capturedAt: input.commitSnapshot.capturedAt,
      },
    );

    await neo4j.run(
      `MERGE (w:CodeNode:WorkingTreeSnapshot {id: $workingTreeSnapshotId})
       SET w.projectId = $projectId,
           w.coreType = 'WorkingTreeSnapshot',
           w.isDirty = $isDirty,
           w.diffHash = $diffHash,
           w.capturedAt = $capturedAt,
           w.updatedAt = toString(datetime())`,
      {
        projectId: input.projectId,
        workingTreeSnapshotId,
        isDirty: input.workingTreeSnapshot.isDirty,
        diffHash: input.workingTreeSnapshot.diffHash,
        capturedAt: input.workingTreeSnapshot.capturedAt,
      },
    );

    if (input.artifact && artifactId) {
      await neo4j.run(
        `MERGE (a:CodeNode:Artifact {id: $artifactId})
         SET a.projectId = $projectId,
             a.coreType = 'Artifact',
             a.path = $path,
             a.sha256 = $sha256,
             a.createdAt = $createdAt,
             a.updatedAt = toString(datetime())`,
        {
          projectId: input.projectId,
          artifactId,
          path: input.artifact.path,
          sha256: input.artifact.sha256,
          createdAt: input.artifact.createdAt,
        },
      );
    }

    await neo4j.run(
      `MATCH (r:VerificationRun {id: $runId, projectId: $projectId})
       MATCH (c:CommitSnapshot {id: $commitSnapshotId, projectId: $projectId})
       MATCH (w:WorkingTreeSnapshot {id: $workingTreeSnapshotId, projectId: $projectId})
       MATCH (g:GateDecision {id: $gateDecisionId, projectId: $projectId})
       MERGE (r)-[e1:CAPTURED_COMMIT]->(c)
       SET e1.projectId = $projectId, e1.updatedAt = toString(datetime())
       MERGE (r)-[e2:CAPTURED_WORKTREE]->(w)
       SET e2.projectId = $projectId, e2.updatedAt = toString(datetime())
       MERGE (r)-[e3:EMITS_GATE_DECISION]->(g)
       SET e3.projectId = $projectId, e3.updatedAt = toString(datetime())
       MERGE (g)-[e4:BASED_ON_RUN]->(r)
       SET e4.projectId = $projectId, e4.updatedAt = toString(datetime())
       MERGE (g)-[e5:AFFECTS_COMMIT]->(c)
       SET e5.projectId = $projectId, e5.updatedAt = toString(datetime())`,
      {
        projectId: input.projectId,
        runId,
        commitSnapshotId,
        workingTreeSnapshotId,
        gateDecisionId,
      },
    );
    edgesCreated += 5;

    if (input.artifact && artifactId) {
      await neo4j.run(
        `MATCH (r:VerificationRun {id: $runId, projectId: $projectId})
         MATCH (a:Artifact {id: $artifactId, projectId: $projectId})
         MERGE (r)-[e:GENERATED_ARTIFACT]->(a)
         SET e.projectId = $projectId, e.updatedAt = toString(datetime())`,
        {
          projectId: input.projectId,
          runId,
          artifactId,
        },
      );
      edgesCreated += 1;
    }

    return {
      runNodeUpserted: 1,
      gateDecisionNodeUpserted: 1,
      commitSnapshotNodeUpserted: 1,
      workingTreeSnapshotNodeUpserted: 1,
      artifactNodeUpserted: input.artifact ? 1 : 0,
      edgesCreated,
    };
  } finally {
    await neo4j.close();
  }
}
