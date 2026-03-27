export type FileRiskLabelPolicyMode = 'included' | 'excluded';
export type ConfigRiskClass = 'NONE' | 'GOVERNANCE_CRITICAL_CONFIG' | 'EXAMPLE_ASSET' | 'TEST_FILE';

export interface FileRiskLabelPolicyEntry {
  label: string;
  mode: FileRiskLabelPolicyMode;
  reason: string;
}

export interface ConfigRiskPatternEntry {
  className: Exclude<ConfigRiskClass, 'NONE'>;
  pattern: RegExp;
  reason: string;
}

/**
 * TODO-4 / GC follow-up policy:
 * Every observed label family must be explicitly accounted for.
 * Included labels contribute to canonical file-tier derivation.
 * Excluded labels are tracked with explicit rationale (never implicit omission).
 */
export const FILE_RISK_LABEL_POLICY: FileRiskLabelPolicyEntry[] = [
  { label: 'Function', mode: 'included', reason: 'Primary executable unit for canonical risk tier derivation.' },
  { label: 'Method', mode: 'included', reason: 'Executable unit equivalent to function semantics.' },
  { label: 'FunctionDeclaration', mode: 'included', reason: 'Executable declaration form in parser output.' },

  { label: 'Class', mode: 'excluded', reason: 'Tracked for coverage; class-level scoring deferred pending class semantic model.' },
  { label: 'Field', mode: 'excluded', reason: 'Tracked for coverage; field-level scoring deferred pending state-risk model.' },
  { label: 'Variable', mode: 'excluded', reason: 'Tracked for coverage; variable-level scoring deferred pending dataflow model.' },
  { label: 'Interface', mode: 'excluded', reason: 'Structural type contract; not executable by default.' },
  { label: 'TypeAlias', mode: 'excluded', reason: 'Structural type alias; not executable by default.' },
  { label: 'Import', mode: 'excluded', reason: 'Dependency indicator; contributes context but not direct executable tier.' },
  { label: 'TypeScript', mode: 'excluded', reason: 'Generic parsed node label; tracked for coverage but not direct tier input.' },
  { label: 'Enum', mode: 'excluded', reason: 'Enum declaration; tracked for coverage pending enum risk semantics.' },
  { label: 'Embedded', mode: 'excluded', reason: 'Embedded structural node; tracked only for explicit coverage accounting.' },
  { label: 'SourceFile', mode: 'excluded', reason: 'Container node; tier is derived, not intrinsic.' },
];

export function policyMap(): Map<string, FileRiskLabelPolicyEntry> {
  return new Map(FILE_RISK_LABEL_POLICY.map((e) => [e.label, e]));
}

export function includedLabels(): string[] {
  return FILE_RISK_LABEL_POLICY.filter((e) => e.mode === 'included').map((e) => e.label);
}

/**
 * TODO-4 Task 8/9:
 * Path-based config-risk family classification used by enrichment + gate diagnostics.
 */
export const CONFIG_RISK_PATTERN_POLICY: ConfigRiskPatternEntry[] = [
  {
    className: 'GOVERNANCE_CRITICAL_CONFIG',
    pattern: /(^|\/)vitest\.config\.[cm]?[jt]s$/i,
    reason: 'Vitest config controls verification contracts and governance-sensitive test/gate behavior.',
  },
  {
    className: 'GOVERNANCE_CRITICAL_CONFIG',
    pattern: /(^|\/)eslint\.config\.[cm]?[jt]s$/i,
    reason: 'Lint config governs static-analysis policy and verification signal quality.',
  },
  {
    className: 'GOVERNANCE_CRITICAL_CONFIG',
    pattern: /(^|\/)tsconfig(\.[^.\/]+)?\.json$/i,
    reason: 'TypeScript compiler config changes semantic model and parser/verification interpretation.',
  },
  {
    className: 'EXAMPLE_ASSET',
    pattern: /(^|\/)examples\//i,
    reason: 'Example/demo assets are excluded from production risk tiers by default but remain in coverage/drift inventory.',
  },
  {
    className: 'TEST_FILE',
    pattern: /(^|\/)__tests__\//i,
    reason: 'Test files cannot earn VR evidence or TESTED_BY edges (they ARE the test), so their confidenceScore is structurally zero and would dilute production averages.',
  },
  {
    className: 'TEST_FILE',
    pattern: /\.test\.[cm]?[jt]sx?$/i,
    reason: 'Test files cannot earn VR evidence or TESTED_BY edges (they ARE the test), so their confidenceScore is structurally zero and would dilute production averages.',
  },
  {
    className: 'TEST_FILE',
    pattern: /\.spec\.[cm]?[jt]sx?$/i,
    reason: 'Test files cannot earn VR evidence or TESTED_BY edges (they ARE the test), so their confidenceScore is structurally zero and would dilute production averages.',
  },
  {
    className: 'TEST_FILE',
    pattern: /\.spec-test\.[cm]?[jt]sx?$/i,
    reason: 'Test files cannot earn VR evidence or TESTED_BY edges (they ARE the test), so their confidenceScore is structurally zero and would dilute production averages.',
  },
  {
    className: 'TEST_FILE',
    pattern: /\.audit\.test\.[cm]?[jt]sx?$/i,
    reason: 'Audit test files are test infrastructure, excluded from production risk scoring.',
  },
];

export function classifyConfigRisk(filePath: string | null | undefined): ConfigRiskClass {
  if (!filePath) return 'NONE';
  const normalized = filePath.replace(/\\/g, '/');
  for (const entry of CONFIG_RISK_PATTERN_POLICY) {
    if (entry.pattern.test(normalized)) {
      return entry.className;
    }
  }
  return 'NONE';
}

export function isGovernanceCriticalConfig(filePath: string | null | undefined): boolean {
  return classifyConfigRisk(filePath) === 'GOVERNANCE_CRITICAL_CONFIG';
}

export function isExampleAssetPath(filePath: string | null | undefined): boolean {
  return classifyConfigRisk(filePath) === 'EXAMPLE_ASSET';
}

export function isTestFile(filePath: string | null | undefined): boolean {
  return classifyConfigRisk(filePath) === 'TEST_FILE';
}

/**
 * Determines if a file should be excluded from production risk scoring.
 * Returns true for TEST_FILE, EXAMPLE_ASSET, and GOVERNANCE_CRITICAL_CONFIG.
 * These files cannot earn VR evidence or TESTED_BY edges, so including them
 * in production risk averages would dilute the score.
 */
export function shouldExcludeFromProductionRisk(filePath: string | null | undefined): boolean {
  return classifyConfigRisk(filePath) !== 'NONE';
}
