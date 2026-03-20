export type FileRiskLabelPolicyMode = 'included' | 'excluded';

export interface FileRiskLabelPolicyEntry {
  label: string;
  mode: FileRiskLabelPolicyMode;
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
