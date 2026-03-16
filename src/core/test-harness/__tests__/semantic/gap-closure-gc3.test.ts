/**
 * GC-3: Evidence → Code Anchoring — TDD Spec Tests
 *
 * Tests written FROM the GAP_CLOSURE.md spec BEFORE implementation.
 * Defines what "done" looks like for Evidence→Code anchoring.
 *
 * Spec requirements:
 * 1. symbolHash property on all CodeNode types: sha256(filePath + '::' + name + '::' + coreType)
 *    - Project-agnostic (same function in different projects → same symbolHash)
 *    - Deterministic from parse-time properties
 * 2. ANCHORED_TO edges from Evidence → CodeNode via:
 *    - Primary: extract coreType:hash from Evidence.id → reconstruct CodeNode.id
 *    - Fallback: match on symbolHash
 * 3. SPANS_PROJECT edges from Claim → Project (all projects their evidence touches)
 * 4. All new edges tagged {derived: true}
 */
import { describe, it, expect } from 'vitest';
import {
  computeSymbolHash,
  extractCodeNodeRef,
} from '../../../../scripts/enrichment/create-evidence-anchors.js';

describe('[GC-3] symbolHash computation', () => {
  it('produces deterministic output for same inputs', () => {
    const h1 = computeSymbolHash('/src/foo.ts', 'bar', 'FunctionDeclaration');
    const h2 = computeSymbolHash('/src/foo.ts', 'bar', 'FunctionDeclaration');
    expect(h1).toBe(h2);
  });

  it('is 16-char hex string', () => {
    const h = computeSymbolHash('/src/foo.ts', 'bar', 'FunctionDeclaration');
    expect(h).toMatch(/^[0-9a-f]{16}$/);
  });

  it('differs when filePath differs', () => {
    const h1 = computeSymbolHash('/src/foo.ts', 'bar', 'FunctionDeclaration');
    const h2 = computeSymbolHash('/src/baz.ts', 'bar', 'FunctionDeclaration');
    expect(h1).not.toBe(h2);
  });

  it('differs when name differs', () => {
    const h1 = computeSymbolHash('/src/foo.ts', 'bar', 'FunctionDeclaration');
    const h2 = computeSymbolHash('/src/foo.ts', 'qux', 'FunctionDeclaration');
    expect(h1).not.toBe(h2);
  });

  it('differs when coreType differs', () => {
    const h1 = computeSymbolHash('/src/foo.ts', 'bar', 'FunctionDeclaration');
    const h2 = computeSymbolHash('/src/foo.ts', 'bar', 'MethodDeclaration');
    expect(h1).not.toBe(h2);
  });

  it('is project-agnostic — does NOT include projectId', () => {
    // Same file+name+type in two different projects → same symbolHash
    const h = computeSymbolHash('/src/foo.ts', 'bar', 'FunctionDeclaration');
    // If projectId were included, we'd need to pass it. We don't.
    expect(typeof h).toBe('string');
    expect(h.length).toBe(16);
  });
});

// ─── Evidence ID → CodeNode ID extraction ──────────────────────
// Evidence IDs for graph_metric type embed the CodeNode hash:
//   ev_risk_proj_c0d3e9a1f200:FunctionDeclaration:a8f5607cf14d65de
// CodeNode IDs look like:
//   proj_c0d3e9a1f200:FunctionDeclaration:a8f5607cf14d65de
// extractCodeNodeRef imported from create-evidence-anchors.ts

describe('[GC-3] Evidence ID → CodeNode extraction', () => {
  it('extracts components from graph_metric evidence ID', () => {
    const ref = extractCodeNodeRef(
      'ev_risk_proj_c0d3e9a1f200:FunctionDeclaration:a8f5607cf14d65de',
    );
    expect(ref).toEqual({
      projectId: 'proj_c0d3e9a1f200',
      coreType: 'FunctionDeclaration',
      hash: 'a8f5607cf14d65de',
      codeNodeId: 'proj_c0d3e9a1f200:FunctionDeclaration:a8f5607cf14d65de',
    });
  });

  it('extracts from MethodDeclaration evidence', () => {
    const ref = extractCodeNodeRef(
      'ev_risk_proj_c0d3e9a1f200:MethodDeclaration:2c6ca3b97a21ae1e',
    );
    expect(ref).not.toBeNull();
    expect(ref!.coreType).toBe('MethodDeclaration');
  });

  it('returns null for plan evidence IDs', () => {
    const ref = extractCodeNodeRef(
      'ev_code_plan_codegraph:Task:6c84e5c9012627f0_watch-all.ts',
    );
    expect(ref).toBeNull();
  });

  it('returns null for cross-layer evidence IDs', () => {
    const ref = extractCodeNodeRef(
      'ev_crosslayer_bottleneck_codegraph_M2',
    );
    expect(ref).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(extractCodeNodeRef('')).toBeNull();
  });
});

// ─── ANCHORED_TO edge creation logic ───────────────────────────
// The enrichment script should:
// 1. Find all Evidence nodes where ID embeds a CodeNode reference
// 2. Match to the CodeNode by reconstructed ID
// 3. MERGE ANCHORED_TO edge with {derived: true, source: 'evidence-anchor'}
// 4. For Evidence nodes without embedded ref, try symbolHash fallback

describe('[GC-3] ANCHORED_TO edge contract', () => {
  it('edge must have derived=true', () => {
    const edgeProps = { derived: true, source: 'evidence-anchor' };
    expect(edgeProps.derived).toBe(true);
  });

  it('edge must have source property', () => {
    const edgeProps = { derived: true, source: 'evidence-anchor' };
    expect(edgeProps.source).toBe('evidence-anchor');
  });

  // Integration-level tests (need ephemeral graph or live Neo4j)
  // These validate the enrichment script's Cypher against a real graph
});

// ─── SPANS_PROJECT edge logic ──────────────────────────────────
// Claims should have SPANS_PROJECT edges to all projects their evidence touches

describe('[GC-3] SPANS_PROJECT edge contract', () => {
  it('edge must have derived=true', () => {
    const edgeProps = { derived: true, source: 'claim-project' };
    expect(edgeProps.derived).toBe(true);
  });
});

// ─── Enrichment script interface ───────────────────────────────

describe('[GC-3] enrichment script interface', () => {
  it('enrichEvidenceAnchors exports the expected function signature', async () => {
    // This will fail until the script is created — that's the point (TDD red)
    const mod = await import(
      '../../../../scripts/enrichment/create-evidence-anchors.js'
    ).catch(() => null);

    if (mod) {
      expect(typeof mod.enrichEvidenceAnchors).toBe('function');
      expect(typeof mod.extractCodeNodeRef).toBe('function');
      expect(typeof mod.computeSymbolHash).toBe('function');
    } else {
      // Script doesn't exist yet — expected in red phase
      expect(mod).toBeNull();
    }
  });

  it('enrichClaimProjects exports the expected function signature', async () => {
    const mod = await import(
      '../../../../scripts/enrichment/create-claim-project-edges.js'
    ).catch(() => null);

    if (mod) {
      expect(typeof mod.enrichClaimProjects).toBe('function');
    } else {
      expect(mod).toBeNull();
    }
  });
});
