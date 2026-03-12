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
  artifacts?: Array<{ location?: { uri?: string } }>;
  results?: SarifResult[];
}

interface SarifResult {
  kind?: string;
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
  attestationRefBase?: string;
  predicateType?: string;
}

function hash(...parts: Array<string | number | undefined>): string {
  return createHash('sha1').update(parts.map((p) => String(p ?? '')).join('|')).digest('hex').slice(0, 20);
}

function sha256Digest(...parts: Array<string | number | undefined>): string {
  return createHash('sha256').update(parts.map((p) => String(p ?? '')).join('|')).digest('hex');
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

function mapSuppressionState(status?: string): 'open' | 'reviewing' | 'to_fix' | 'ignored' | 'dismissed' | 'fixed' | 'closed' | 'reopened' | 'provisionally_ignored' {
  const normalized = (status ?? '').toLowerCase();
  if (normalized.includes('review')) return 'reviewing';
  if (normalized.includes('reject')) return 'reopened';
  if (normalized.includes('dismiss') || normalized.includes('accept') || normalized.includes('approved')) return 'dismissed';
  if (normalized.includes('fixed') || normalized.includes('resolved') || normalized.includes('close')) return 'fixed';
  return 'ignored';
}

function mapSuppressionReason(justification?: string): 'false_positive' | 'acceptable_risk' | 'wont_fix' | 'used_in_tests' | 'no_time_to_fix' | 'compensating_control' | 'other' {
  const text = (justification ?? '').toLowerCase();
  if (text.includes('false positive')) return 'false_positive';
  if (text.includes('acceptable risk') || text.includes('accepted risk')) return 'acceptable_risk';
  if (text.includes("won't fix") || text.includes('wont fix')) return 'wont_fix';
  if (text.includes('test') || text.includes('testing')) return 'used_in_tests';
  if (text.includes('no time') || text.includes('time constraint')) return 'no_time_to_fix';
  if (text.includes('compensating control')) return 'compensating_control';
  return 'other';
}

function extractTicketRef(text?: string): string | undefined {
  if (!text) return undefined;
  const m = text.match(/\b([A-Z][A-Z0-9]+-\d+)\b/);
  return m?.[1];
}

function mapAdjudicationSource(kind?: string): string {
  const normalized = (kind ?? '').toLowerCase();
  if (normalized.includes('external')) return 'external_dismissal';
  if (normalized.includes('insource') || normalized.includes('in_source') || normalized.includes('in-source')) return 'inline_suppression';
  return 'sarif_suppression';
}

function computeScopeCompleteness(params: {
  targetFileCount?: number;
  analyzedFileCount?: number;
  skippedFileCount?: number;
  analysisErrorCount?: number;
}): 'complete' | 'partial' | 'unknown' {
  const target = params.targetFileCount ?? 0;
  const analyzed = params.analyzedFileCount ?? 0;
  const skipped = params.skippedFileCount ?? 0;
  const errors = params.analysisErrorCount ?? 0;

  if (errors > 0) return 'partial';
  if (target > 0 && analyzed >= target && skipped === 0) return 'complete';
  if (target > 0 && analyzed > 0) return 'partial';
  if (target > 0 && analyzed === 0) return 'unknown';
  if (analyzed > 0) return 'complete';
  return 'unknown';
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

  const attestationRefBase = options.attestationRefBase ?? 'urn:codegraph:attestation';
  const predicateType = options.predicateType ?? 'https://in-toto.io/Statement/v1';

  for (const run of runs) {
    if (!matchesTool(run, options.toolFilter ?? 'codeql')) continue;

    const toolName = run.tool?.driver?.name ?? 'unknown';
    const toolVersion = run.tool?.driver?.version ?? run.tool?.driver?.semanticVersion;
    const runConfigHash = hash(run.automationDetails?.id, run.invocations?.[0]?.commandLine, JSON.stringify(run.tool?.driver));

    const results = run.results ?? [];
    const includedPaths = new Set<string>();
    const artifactPaths = new Set<string>();
    const runIdsForScope: string[] = [];

    for (const artifact of run.artifacts ?? []) {
      const uri = artifact.location?.uri;
      if (uri) artifactPaths.add(uri);
    }

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

      const digest = `sha256:${sha256Digest(options.projectId, toolName, result.ruleId, fingerprint, runConfigHash)}`;
      const attestationRef = `${attestationRefBase}/${normalizeToolName(toolName)}/${runConfigHash}/${digest.slice(7, 27)}`;

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

        // VerificationRun attestation/provenance refs
        attestationRef,
        subjectDigest: digest,
        predicateType,
        verifierId: toolVersion ? `${toolName}@${toolVersion}` : toolName,
        timeVerified: now,

        // path witness summary (compact v1)
        externalContextSnapshotRef: relatedLocationCount > 0 || codeFlowCount > 0
          ? JSON.stringify({ relatedLocations: relatedLocationCount, codeFlows: codeFlowCount })
          : undefined,
      };

      verificationRuns.push(runNode);
      runIdsForScope.push(rid);

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

      // Suppressions are adjudication evidence, not safety proof.
      // Normalize inline suppressions + external dismissals into AdjudicationRecord.
      for (const sup of result.suppressions ?? []) {
        const source = mapAdjudicationSource(sup.kind);
        const comment = sup.justification ?? sup.status ?? 'SARIF suppression imported';
        adjudications.push({
          id: `adj:${hash(rid, source, sup.status, comment)}`,
          projectId: options.projectId,
          targetNodeId: rid,
          adjudicationState: mapSuppressionState(sup.status),
          adjudicationReason: mapSuppressionReason(comment),
          adjudicationComment: comment,
          adjudicationSource: source,
          requestedAt: now,
          ticketRef: extractTicketRef(comment),
          requiresRevalidation: true,
        });
      }
    }

    // Clean run evidence (no findings): capture as SATISFIES candidate, later subject to scope-aware correction.
    if (results.length === 0) {
      const cleanFingerprint = `clean:${hash(runConfigHash, options.baselineRef, options.mergeBase)}`;
      const cleanRunId = `vr:${options.projectId}:${normalizeToolName(toolName)}:clean:${hash(cleanFingerprint, runConfigHash)}`;
      const digest = `sha256:${sha256Digest(options.projectId, toolName, cleanFingerprint, runConfigHash)}`;

      verificationRuns.push({
        id: cleanRunId,
        projectId: options.projectId,
        tool: toolName,
        toolVersion,
        status: 'satisfies',
        criticality: 'medium',
        confidence: 0.7,
        evidenceGrade: 'A2',
        freshnessTs: now,
        reproducible: true,
        resultFingerprint: cleanFingerprint,
        lifecycleState: 'clean',
        firstSeenTs: now,
        lastSeenTs: now,
        baselineRef: options.baselineRef,
        mergeBase: options.mergeBase,
        queryPackId: run.automationDetails?.id,
        ruleId: '__clean_run__',
        runConfigHash,
        attestationRef: `${attestationRefBase}/${normalizeToolName(toolName)}/${runConfigHash}/${digest.slice(7, 27)}`,
        subjectDigest: digest,
        predicateType,
        verifierId: toolVersion ? `${toolName}@${toolVersion}` : toolName,
        timeVerified: now,
        createdAt: now,
        updatedAt: now,
      });

      runIdsForScope.push(cleanRunId);
    }

    const scopeSeed = Array.from(new Set([...includedPaths, ...artifactPaths]));
    const invocation = run.invocations?.[0];
    const executionSuccessful = invocation?.executionSuccessful;
    const warningCount = invocation?.toolConfigurationNotifications?.length ?? 0;
    const targetFileCount = scopeSeed.length;
    const analyzedFileCount = scopeSeed.length;
    const skippedFileCount = 0;
    const analysisErrorCount = executionSuccessful === false ? 1 : 0;

    const scopeTemplate = {
      projectId: options.projectId,
      scanRoots: [] as string[],
      includedPaths: scopeSeed,
      excludedPaths: [] as string[],
      buildMode: 'custom' as const,
      supportedLanguages: [] as string[],
      analyzedLanguages: [] as string[],
      targetFileCount,
      analyzedFileCount,
      skippedFileCount,
      analysisErrorCount,
      warningCount,
      suppressedErrors: false,
      scopeCompleteness: computeScopeCompleteness({
        targetFileCount,
        analyzedFileCount,
        skippedFileCount,
        analysisErrorCount,
      }),
      scopeEvidenceRef: options.sarifPath,
      unscannedTargetNodeIds: [] as string[],
    };

    // Attach one scope per imported verification run from this SARIF run.
    const scopeIdBase = `scope:${options.projectId}:${normalizeToolName(toolName)}:${hash(runConfigHash, now)}`;
    for (let i = 0; i < runIdsForScope.length; i++) {
      const runId = runIdsForScope[i];
      analysisScopes.push({
        id: `${scopeIdBase}:${i}`,
        verificationRunId: runId,
        ...scopeTemplate,
      });
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
