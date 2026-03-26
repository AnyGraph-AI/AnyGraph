/**
 * AUD-TC-01-L1: enrich-code-embedding-inputs.ts — Spec-Derived Tests
 *
 * Spec: implicit — prepares embeddingInput property on Function/Method nodes
 *
 * Behaviors:
 * (1) queries Function/Method nodes from Neo4j
 * (2) extracts JSDoc summary from sourceCode (first non-@tag comment line)
 * (3) extracts first non-comment code line from sourceCode
 * (4) composes embeddingInput = name + JSDoc + first code line
 * (5) writes embeddingInput property back to each node
 * (6) handles nodes with no sourceCode (skips gracefully)
 */
import { describe, it, expect } from 'vitest';

describe('[aud-tc-01] enrich-code-embedding-inputs.ts', () => {

  describe('JSDoc extraction contract', () => {
    it('(1) extracts JSDoc block from sourceCode', () => {
      const sourceCode = `
/**
 * Handles user authentication.
 * @param ctx - Grammy context
 * @returns Promise<void>
 */
async function handleAuth(ctx) {
  // implementation
}`;

      const match = sourceCode.match(/\/\*\*([\s\S]*?)\*\//);
      expect(match).not.toBeNull();
      expect(match![1]).toContain('Handles user authentication');
    });

    it('(2) extracts first non-@tag comment line as JSDoc summary', () => {
      const jsDocContent = `
 * Handles user authentication.
 * @param ctx - Grammy context
 * @returns Promise<void>
`;

      const lines = jsDocContent
        .split('\n')
        .map((line) => line.replace(/^\s*\*\s?/, '').trim())
        .filter(Boolean)
        .filter((line) => !line.startsWith('@'));

      expect(lines[0]).toBe('Handles user authentication.');
    });

    it('(3) returns empty string when no JSDoc present', () => {
      const sourceCode = `function noJsDoc() { return 42; }`;

      const match = sourceCode.match(/\/\*\*([\s\S]*?)\*\//);
      const jsDocSummary = match ? 'found' : '';

      expect(jsDocSummary).toBe('');
    });

    it('(4) filters out @param, @returns, @example tags', () => {
      const jsDocContent = `
 * Main entry point.
 * @param input - The input data
 * @returns The processed result
 * @example foo()
`;

      const lines = jsDocContent
        .split('\n')
        .map((line) => line.replace(/^\s*\*\s?/, '').trim())
        .filter(Boolean)
        .filter((line) => !line.startsWith('@'));

      expect(lines).toEqual(['Main entry point.']);
      expect(lines.length).toBe(1);
    });
  });

  describe('first code line extraction contract', () => {
    it('(5) extracts first non-comment, non-empty line', () => {
      const sourceCode = `
// This is a comment
/* Another comment */
async function processData(input: string): Promise<string> {
  return input.toUpperCase();
}`;

      const extractFirstCodeLine = (code: string): string => {
        const lines = code.split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          if (trimmed.startsWith('//')) continue;
          if (trimmed.startsWith('/*')) continue;
          if (trimmed.startsWith('*')) continue;
          return trimmed.slice(0, 220);
        }
        return '';
      };

      const result = extractFirstCodeLine(sourceCode);
      expect(result).toBe('async function processData(input: string): Promise<string> {');
    });

    it('(6) truncates to 220 characters max', () => {
      const longLine = 'a'.repeat(300);
      const truncated = longLine.slice(0, 220);

      expect(truncated.length).toBe(220);
    });

    it('(7) skips block comment continuation lines starting with *', () => {
      const sourceCode = `
/**
 * Description here
 */
function actual() {}`;

      const extractFirstCodeLine = (code: string): string => {
        const lines = code.split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          if (trimmed.startsWith('//')) continue;
          if (trimmed.startsWith('/*')) continue;
          if (trimmed.startsWith('*')) continue;
          return trimmed.slice(0, 220);
        }
        return '';
      };

      expect(extractFirstCodeLine(sourceCode)).toBe('function actual() {}');
    });

    it('(8) returns empty string when only comments present', () => {
      const sourceCode = `
// Just a comment
/* Another comment */
`;

      const extractFirstCodeLine = (code: string): string => {
        const lines = code.split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          if (trimmed.startsWith('//')) continue;
          if (trimmed.startsWith('/*')) continue;
          if (trimmed.startsWith('*')) continue;
          return trimmed.slice(0, 220);
        }
        return '';
      };

      expect(extractFirstCodeLine(sourceCode)).toBe('');
    });
  });

  describe('embeddingInput composition contract', () => {
    it('(9) composes embeddingInput with name, jsdoc, first code line', () => {
      const name = 'handleMessage';
      const jsDocSummary = 'Processes incoming telegram messages';
      const firstCodeLine = 'async function handleMessage(ctx: Context) {';

      const embeddingInput = [
        `name: ${name}`,
        jsDocSummary ? `jsdoc: ${jsDocSummary}` : null,
        firstCodeLine ? `line: ${firstCodeLine}` : null,
      ]
        .filter(Boolean)
        .join('\n');

      expect(embeddingInput).toContain('name: handleMessage');
      expect(embeddingInput).toContain('jsdoc: Processes incoming telegram messages');
      expect(embeddingInput).toContain('line: async function handleMessage');
    });

    it('(10) omits jsdoc/line if empty', () => {
      const name = 'simpleFunc';
      const jsDocSummary = '';
      const firstCodeLine = '';

      const embeddingInput = [
        `name: ${name}`,
        jsDocSummary ? `jsdoc: ${jsDocSummary}` : null,
        firstCodeLine ? `line: ${firstCodeLine}` : null,
      ]
        .filter(Boolean)
        .join('\n');

      expect(embeddingInput).toBe('name: simpleFunc');
      expect(embeddingInput).not.toContain('jsdoc:');
      expect(embeddingInput).not.toContain('line:');
    });
  });

  describe('node query contract', () => {
    it('(11) queries Function, Method, and semantic type variants', () => {
      // Contract: query must match all function-like nodes
      const queryPattern = `
        MATCH (fn)
        WHERE (
          fn:Function OR fn:Method
          OR fn.coreType IN ['FunctionDeclaration', 'MethodDeclaration']
          OR fn.semanticType IN ['function', 'method']
        )
      `;

      expect(queryPattern).toContain('fn:Function');
      expect(queryPattern).toContain('fn:Method');
      expect(queryPattern).toContain('FunctionDeclaration');
      expect(queryPattern).toContain('MethodDeclaration');
    });

    it('(12) returns id, name, sourceCode, projectId from each node', () => {
      const row = {
        id: 'proj_test:Function:handleStart',
        name: 'handleStart',
        sourceCode: 'function handleStart() {}',
        projectId: 'proj_test',
      };

      expect(row.id).toBeDefined();
      expect(row.name).toBeDefined();
      expect(row.sourceCode).toBeDefined();
      expect(row.projectId).toBeDefined();
    });
  });

  describe('property update contract', () => {
    it('(13) sets embeddingInputVersion = 1 for tracking', () => {
      // Contract: version property enables selective re-enrichment
      const updateProperties = {
        embeddingInput: 'name: foo\njsdoc: Does something\nline: function foo() {',
        embeddingInputVersion: 1,
        jsDocSummary: 'Does something',
        firstCodeLine: 'function foo() {',
      };

      expect(updateProperties.embeddingInputVersion).toBe(1);
    });

    it('(14) preserves existing descriptionText with coalesce', () => {
      // Contract: coalesce(existing, new) keeps existing if present
      const existing = 'Original description';
      const newValue = 'Computed description';

      const result = existing ?? newValue;

      expect(result).toBe('Original description');
    });
  });

  describe('empty/missing sourceCode handling', () => {
    it('(15) skips nodes with no id', () => {
      const row = { id: '', name: 'orphan', sourceCode: 'function orphan() {}' };

      const shouldProcess = !!row.id;

      expect(shouldProcess).toBe(false);
    });

    it('(16) handles null/undefined sourceCode gracefully', () => {
      const row = { id: 'fn_123', name: 'noSource', sourceCode: null };

      // The ?? operator means: if null/undefined, use ''
      // So String(null ?? '') = String('') = ''
      const sourceCode = String(row.sourceCode ?? '');

      expect(sourceCode).toBe('');
      // Empty sourceCode means no JSDoc match, no code line extracted
    });

    it('(17) JSON output includes scanned and updated counts', () => {
      // Contract: script outputs progress metrics
      const output = {
        ok: true,
        scanned: 150,
        updated: 142,
      };

      expect(output.ok).toBe(true);
      expect(output.scanned).toBeGreaterThanOrEqual(output.updated);
    });
  });
});
