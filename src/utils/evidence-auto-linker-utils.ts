export type AutoLinkMatchType = 'explicit_ref' | 'exact_file' | 'function_name' | 'keyword';
export type EvidenceRefType =
  | 'file_path'
  | 'function'
  | 'class'
  | 'interface'
  | 'field'
  | 'type_alias'
  | 'variable'
  | 'import'
  | 'auto_link';
export type EvidenceRole = 'target' | 'proof';

export interface CodeAsset {
  name: string;
  filePath: string;
  elementId: string;
  kind: string;
}

export function classifyAssetForEvidence(asset: CodeAsset): { refType: EvidenceRefType; evidenceRole: EvidenceRole } {
  switch (asset.kind) {
    case 'SourceFile':
      return { refType: 'file_path', evidenceRole: 'target' };
    case 'Function':
    case 'Method':
      return { refType: 'function', evidenceRole: 'target' };
    case 'Class':
      return { refType: 'class', evidenceRole: 'target' };
    case 'Interface':
      return { refType: 'interface', evidenceRole: 'target' };
    case 'Field':
      return { refType: 'field', evidenceRole: 'target' };
    case 'TypeAlias':
      return { refType: 'type_alias', evidenceRole: 'target' };
    case 'Variable':
      return { refType: 'variable', evidenceRole: 'target' };
    case 'Import':
      return { refType: 'import', evidenceRole: 'target' };
    case 'TestFile':
      return { refType: 'file_path', evidenceRole: 'proof' };
    default:
      return { refType: 'auto_link', evidenceRole: 'target' };
  }
}

export function extractBacktickRefs(taskName: string): string[] {
  const refs = Array.from(taskName.matchAll(/`([^`]+)`/g), (m) => m[1]?.trim() ?? '').filter(Boolean);
  return [...new Set(refs)];
}

export function normalizeIdentifier(ref: string): string {
  return ref.replace(/\(\)$/g, '').trim();
}

export function isLikelyFileRef(ref: string): boolean {
  return /\//.test(ref) || /\.(ts|tsx|js|jsx|json|md|yml|yaml)$/i.test(ref);
}

export function matchExplicitRefs(taskName: string, assets: CodeAsset[]): Array<{ asset: CodeAsset; matchType: AutoLinkMatchType; confidence: number }> {
  const refs = extractBacktickRefs(taskName);
  const matches: Array<{ asset: CodeAsset; matchType: AutoLinkMatchType; confidence: number }> = [];

  for (const ref of refs) {
    if (isLikelyFileRef(ref)) {
      const normalizedRef = ref.replace(/^\/+/, '').toLowerCase();
      const fileHits = assets.filter((a) => {
        if (a.kind !== 'SourceFile') return false;
        const fp = a.filePath.replace(/^\/+/, '').toLowerCase();
        const n = a.name.toLowerCase();
        return fp.endsWith(normalizedRef) || n === normalizedRef || fp.includes(normalizedRef);
      });
      for (const hit of fileHits) matches.push({ asset: hit, matchType: 'explicit_ref', confidence: 0.99 });
      continue;
    }

    const ident = normalizeIdentifier(ref).toLowerCase();
    if (!ident) continue;
    const identHits = assets.filter((a) => a.name.toLowerCase() === ident);
    for (const hit of identHits) matches.push({ asset: hit, matchType: 'explicit_ref', confidence: 0.98 });
  }

  const seen = new Set<string>();
  return matches.filter((m) => {
    const key = `${m.asset.elementId}:${m.matchType}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
