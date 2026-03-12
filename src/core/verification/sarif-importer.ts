import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

import type { VerificationFoundationBundle } from './verification-schema.js';

interface SarifLog {
  version?: string;
  runs?: SarifRun[];
}

interface SarifRun {
  tool?: {
    driver?: {
      name?: string;
      version?: string;
      semanticVersion?: string;
      rules?: Array<{ id?: string; shortDescription?: { text?: string }; fullDescription?: { text?: string } }>;
    };
  };
  automationDetails?: { id?: string };
  baselineGuid?: string;
  invocations?: Array<{ executionSuccessful?: boolean; commandLine?: string; toolConfigurationNotifications?: unknown[] }>;
  results?: SarifResult[];
}

interface SarifResult {
  ruleId?: string;
  level?: string;
  message?: { text?: string };
  partialFingerprints?: Record<string, string>;
  baselineState?: string;
  locations?: SarifLocation[];
  relatedLocations?: SarifLocation[];
  suppressions?: Array<{ kind?: string; justification?: string; status?: string }>;
}

interface SarifLocation {
  id?: number;
  physicalLocation?: {
    artifactLocation?: { uri?: string };
    region?: { startLine?: number; endLine?: number };
  };
  message?: { text?: string };
}

export interface SarifImportOptions {
  projectId: string;
  sarifPath: string;
  toolFilter?: 'codeql' | 'semgrep' | 'any';
  baselineRef?: string;
  mergeBase?: string;
}

function hash(...parts: Array<string | number | undefined>): string {
  return createHash('sha1').update(parts.map((p) => String(p ?? '')).join('|')).digest('hex').slice(0, 20);
}

function normalizeToolName(name?: string): string {
  return (name ?? 'unknown').toLowerCase();
}

function matchesTool(run: SarifRun, filter: SarifImportOptions['toolFilter']): boolean {
  if (!filter || filter === 'any') return true;
  const tool = normalizeToolName(run.tool?.driver?.name);
  if (filter === 'codeql') return tool.includes('codeql');
  if (filter === 'semgrep') return tool.includes('semgrep');
  return true;
}

function mapLevelToCriticality(level?: string): 'low' | 'medium' | 'high' | 'safety_critical' {
  const l = (level ?? '').toLowerCase();
  if (l === 'error') return 'high';
  if (l === 'warning') return 'medium';
  return 'low';
}

function mapLevelToConfidence(level?: string): number {
  const l = (level ?? '').toLowerCase();
  if (l === 'error') return 0.9;
  if (l === 'warning') return 0.8;
  return 0.7;
}

function chooseFingerprint(result: SarifResult): string {
  const pf = result.partialFingerprints ?? {};
  return (
    pf.primaryLocationLineHash ??
    pf.primaryLocationStartColumnFingerprint ??
    pf.primaryLocationStartLineFingerprint ??
    hash(result.ruleId, result.message?.text, result.locations?.[0]?.physicalLocation?.artifactLocation?.uri)
  );
}

export async function importSarifToVerificationBundle(
  options: SarifImportOptions,
): Promise<VerificationFoundationBundle> {
  const raw = await readFile(options.sarifPath, 'utf8');
  const sarif = JSON.parse(raw) as SarifLog;
  const runs = sarif.runs ?? [];
  const now = new Date().toISOString();

  const verificationRuns: VerificationFoundationBundle['verificationRuns'] = [];
  const analysisScopes: VerificationFoundationBundle['analysisScopes'] = [];
  const adjudications: VerificationFoundationBundle['adjudications'] = [];
  const pathWitnesses: VerificationFoundationBundle['pathWitnesses'] = [];

  for (const run of runs) {
    if (!matchesTool(run, options.toolFilter ?? 'codeql')) continue;

    const toolName = run.tool?.driver?.name ?? 'unknown';
    const toolVersion = run.tool?.driver?.version ?? run.tool?.driver?.semanticVersion;
    const runConfigHash = hash(run.automationDetails?.id, run.invocations?.[0]?.commandLine, JSON.stringify(run.tool?.driver));

    const results = run.results ?? [];
    const includedPaths = new Set<string>();

    for (const result of results) {
      const fingerprint = chooseFingerprint(result);
      const rid = `vr:${options.projectId}:${normalizeToolName(toolName)}:${hash(fingerprint, result.ruleId)}`;
      const level = result.level ?? 'warning';
      const criticality = mapLevelToCriticality(level);

      const relatedLocationCount = (result.relatedLocations ?? []).length;
      const codeFlowCount = 0; // kept for schema placeholder, can expand when parsing codeFlows in detail

      const locs = result.locations ?? [];
      for (const loc of locs) {
        const uri = loc.physicalLocation?.artifactLocation?.uri;
        if (uri) includedPaths.add(uri);
      }

      const runNode = {
        id: rid,
        projectId: options.projectId,
        tool: toolName,
        toolVersion,
        status: 'violates' as const,
        criticality,
        confidence: mapLevelToConfidence(level),
        evidenceGrade: 'A2' as const,
        freshnessTs: now,
        reproducible: true,
        resultFingerprint: fingerprint,
        lifecycleState: result.baselineState ?? 'open',
        firstSeenTs: now,
        lastSeenTs: now,
        baselineRef: options.baselineRef,
        mergeBase: options.mergeBase,
        queryPackId: run.automationDetails?.id,
        ruleId: result.ruleId,
        runConfigHash,
        createdAt: now,
        updatedAt: now,
        // path witness summary (compact v1)
        externalContextSnapshotRef: relatedLocationCount > 0 || codeFlowCount > 0
          ? JSON.stringify({ relatedLocations: relatedLocationCount, codeFlows: codeFlowCount })
          : undefined,
      };

      verificationRuns.push(runNode);

      if ((criticality === 'high' || criticality === 'safety_critical') && (relatedLocationCount > 0 || codeFlowCount > 0)) {
        pathWitnesses.push({
          id: `pw:${hash(rid, fingerprint)}`,
          projectId: options.projectId,
          verificationRunId: rid,
          witnessType: relatedLocationCount > 0 && codeFlowCount > 0 ? 'hybrid' : (relatedLocationCount > 0 ? 'relatedLocations' : 'codeFlows'),
          criticality,
          summary: `relatedLocations=${relatedLocationCount}, codeFlows=${codeFlowCount}`,
          payloadJson: JSON.stringify({
            locations: result.locations ?? [],
            relatedLocations: result.relatedLocations ?? [],
          }),
        });
      }

      // Suppressions are adjudication evidence, not safety proof
      for (const sup of result.suppressions ?? []) {
        adjudications.push({
          id: `adj:${hash(rid, sup.kind, sup.justification)}`,
          projectId: options.projectId,
          targetNodeId: rid,
          adjudicationState: 'ignored',
          adjudicationReason: 'other',
          adjudicationComment: sup.justification ?? sup.status ?? 'SARIF suppression imported',
          adjudicationSource: 'sarif_import',
          requestedAt: now,
          requiresRevalidation: true,
        });
      }
    }

    const scopeId = `scope:${options.projectId}:${normalizeToolName(toolName)}:${hash(runConfigHash, now)}`;
    const invocation = run.invocations?.[0];
    const executionSuccessful = invocation?.executionSuccessful;

    const scopeCompleteness: 'partial' | 'complete' = executionSuccessful === false ? 'partial' : 'complete';

    const scopeTemplate = {
      projectId: options.projectId,
      scanRoots: [] as string[],
      includedPaths: Array.from(includedPaths),
      excludedPaths: [] as string[],
      buildMode: 'custom' as const,
      supportedLanguages: [] as string[],
      analyzedLanguages: [] as string[],
      targetFileCount: includedPaths.size,
      analyzedFileCount: includedPaths.size,
      skippedFileCount: 0,
      analysisErrorCount: executionSuccessful === false ? 1 : 0,
      warningCount: 0,
      suppressedErrors: false,
      scopeCompleteness,
      scopeEvidenceRef: options.sarifPath,
      unscannedTargetNodeIds: [] as string[],
    };

    // Attach one scope per imported finding run
    const start = verificationRuns.length - (results.length || 0);
    const end = verificationRuns.length;
    let ordinal = 0;
    for (let i = start; i < end; i++) {
      if (!verificationRuns[i]) continue;
      analysisScopes.push({
        id: `${scopeId}:${ordinal}`,
        verificationRunId: verificationRuns[i].id,
        ...scopeTemplate,
      });
      ordinal++;
    }
  }

  return {
    projectId: options.projectId,
    verificationRuns,
    analysisScopes,
    adjudications,
    pathWitnesses,
  };
}
