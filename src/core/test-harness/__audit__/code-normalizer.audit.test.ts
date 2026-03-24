// Fork: Drew/Jason origin
// AUD-TC Audit — B6 (Health Witness)
// Spec-derived tests for code-normalizer.ts (structural duplicate detection utility)

import { describe, it, expect } from 'vitest';
import { normalizeCode, areMetricsSimilar, StructuralMetrics } from '../../utils/code-normalizer';

describe('code-normalizer audit tests', () => {
  // ─── Behavior 1: empty/whitespace-only input ───
  describe('normalizeCode — empty/whitespace input', () => {
    it('returns empty normalizedCode and hash for empty string', () => {
      const result = normalizeCode('');
      expect(result.normalizedCode).toBe('');
      expect(result.normalizedHash).toBe('');
      expect(result.metrics).toEqual({
        parameterCount: 0,
        statementCount: 0,
        controlFlowDepth: 0,
        lineCount: 0,
        tokenCount: 0,
      });
    });

    it('returns empty normalizedCode and hash for whitespace-only string', () => {
      const result = normalizeCode('   \n\t\n   ');
      expect(result.normalizedCode).toBe('');
      expect(result.normalizedHash).toBe('');
      expect(result.metrics.lineCount).toBe(0);
    });
  });

  // ─── Behavior 2: strips comments ───
  describe('normalizeCode — comment stripping', () => {
    it('strips single-line comments', () => {
      const code = 'const x = 1; // this is a comment\nconst y = 2;';
      const result = normalizeCode(code);
      expect(result.normalizedCode).not.toContain('this is a comment');
    });

    it('strips multi-line comments', () => {
      const code = '/* block comment */\nconst x = 1;';
      const result = normalizeCode(code);
      expect(result.normalizedCode).not.toContain('block comment');
    });

    it('strips multi-line comments spanning multiple lines', () => {
      const code = '/*\n * multi\n * line\n */\nconst x = 1;';
      const result = normalizeCode(code);
      expect(result.normalizedCode).not.toContain('multi');
      expect(result.normalizedCode).not.toContain('line');
    });
  });

  // ─── Behavior 3: string literal replacement ───
  // FINDING: BUG — $STR placeholder is corrupted by replaceVariableNames.
  // The identifier regex uses \b which treats $ as non-word, so it matches "STR" (not "$STR")
  // and replaces it with $VAR_N, producing "$$VAR_N". RESERVED_KEYWORDS includes "$STR"
  // but the regex can never match it due to \b semantics. ~3-line fix in replaceVariableNames.
  describe('normalizeCode — string literal replacement', () => {
    it('removes string literal content from output', () => {
      const code = 'const x = "hello world";';
      const result = normalizeCode(code);
      expect(result.normalizedCode).not.toContain('hello world');
    });

    it('removes single-quoted string content from output', () => {
      const code = "const x = 'hello world';";
      const result = normalizeCode(code);
      expect(result.normalizedCode).not.toContain('hello world');
    });

    it('removes backtick template literal content from output', () => {
      const code = 'const x = `template string`;';
      const result = normalizeCode(code);
      expect(result.normalizedCode).not.toContain('template string');
    });

    // FINDING: $STR placeholder gets mangled to $$VAR_N due to \b word boundary bug.
    // This test documents the actual (buggy) behavior.
    it('replaces string content but $STR placeholder is corrupted by variable renaming', () => {
      const code = 'const x = "hello";';
      const result = normalizeCode(code);
      // Expect $$VAR_N instead of $STR due to the \b bug
      expect(result.normalizedCode).toMatch(/\$\$VAR_\d+/);
    });
  });

  // ─── Behavior 4: numeric literal replacement ───
  // FINDING: Same \b bug as $STR — $NUM placeholder is corrupted to $$VAR_N.
  // replaceNumericLiterals inserts "$NUM", then replaceVariableNames matches "NUM" via \b
  // and renames it to $VAR_N, producing "$$VAR_N".
  describe('normalizeCode — numeric literal replacement', () => {
    it('removes integer literal from output', () => {
      const code = 'const x = 42;';
      const result = normalizeCode(code);
      // 42 should not appear literally (it gets replaced, then mangled)
      expect(result.normalizedCode).not.toContain(' 42');
    });

    it('removes float literal from output', () => {
      const code = 'const x = 3.14;';
      const result = normalizeCode(code);
      expect(result.normalizedCode).not.toContain('3.14');
    });

    it('removes hex literal from output', () => {
      const code = 'const x = 0xFF;';
      const result = normalizeCode(code);
      expect(result.normalizedCode).not.toContain('0xFF');
    });

    it('removes binary literal from output', () => {
      const code = 'const x = 0b1010;';
      const result = normalizeCode(code);
      expect(result.normalizedCode).not.toContain('0b1010');
    });

    it('removes octal literal from output', () => {
      const code = 'const x = 0o777;';
      const result = normalizeCode(code);
      expect(result.normalizedCode).not.toContain('0o777');
    });

    it('removes scientific notation from output', () => {
      const code = 'const x = 1e10;';
      const result = normalizeCode(code);
      // SPEC-GAP: Spec says scientific notation replaced, but doesn't specify exact regex behavior for "1e10" vs "1E+10"
      expect(result.normalizedCode).not.toContain('1e10');
    });

    it('removes BigInt literal from output', () => {
      const code = 'const x = 123n;';
      const result = normalizeCode(code);
      expect(result.normalizedCode).not.toContain('123n');
    });

    // FINDING: $NUM placeholder gets mangled to $$VAR_N (same bug as $STR)
    it('numeric placeholder is corrupted by variable renaming (same $STR bug)', () => {
      const code = 'const x = 42;';
      const result = normalizeCode(code);
      expect(result.normalizedCode).toMatch(/\$\$VAR_\d+/);
    });
  });

  // ─── Behavior 5: identifier replacement with positional placeholders ───
  describe('normalizeCode — identifier replacement', () => {
    it('replaces non-reserved identifiers with $VAR_N placeholders', () => {
      const code = 'const myVar = 1;';
      const result = normalizeCode(code);
      expect(result.normalizedCode).toContain('$VAR_');
      expect(result.normalizedCode).not.toContain('myVar');
    });

    it('assigns same placeholder to same identifier across occurrences', () => {
      const code = 'const foo = 1;\nconst bar = foo;';
      const result = normalizeCode(code);
      // "foo" appears twice — should get the same placeholder both times
      const matches = result.normalizedCode.match(/\$VAR_\d+/g) ?? [];
      // Find which $VAR_N corresponds to "foo" (appears twice)
      const counts = new Map<string, number>();
      for (const m of matches) {
        counts.set(m, (counts.get(m) ?? 0) + 1);
      }
      // At least one placeholder should appear twice (for "foo")
      const hasDuplicate = [...counts.values()].some((c) => c >= 2);
      expect(hasDuplicate).toBe(true);
    });

    it('assigns different placeholders to different identifiers', () => {
      const code = 'const alpha = 1;\nconst beta = 2;';
      const result = normalizeCode(code);
      // Both alpha and beta should get unique $VAR_N
      const matches = result.normalizedCode.match(/\$VAR_\d+/g) ?? [];
      const unique = new Set(matches);
      // Should have at least 2 unique placeholders (alpha, beta)
      expect(unique.size).toBeGreaterThanOrEqual(2);
    });
  });

  // ─── Behavior 6: reserved keyword preservation ───
  describe('normalizeCode — reserved keyword preservation', () => {
    it('preserves TypeScript keywords', () => {
      const code = 'const x = 1;\nif (x) { return x; }';
      const result = normalizeCode(code);
      expect(result.normalizedCode).toContain('const');
      expect(result.normalizedCode).toContain('if');
      expect(result.normalizedCode).toContain('return');
    });

    it('preserves built-in types', () => {
      const code = 'function foo(x: number, y: string): boolean { return true; }';
      const result = normalizeCode(code);
      expect(result.normalizedCode).toContain('number');
      expect(result.normalizedCode).toContain('string');
      expect(result.normalizedCode).toContain('boolean');
      expect(result.normalizedCode).toContain('function');
      expect(result.normalizedCode).toContain('return');
      expect(result.normalizedCode).toContain('true');
    });

    it('preserves common built-in objects', () => {
      const code = 'console.log(JSON.stringify(Array.from(mySet)));';
      const result = normalizeCode(code);
      expect(result.normalizedCode).toContain('console');
      expect(result.normalizedCode).toContain('JSON');
      expect(result.normalizedCode).toContain('Array');
    });
  });

  // ─── Behavior 7: deterministic SHA256 hash ───
  describe('normalizeCode — deterministic hash', () => {
    it('produces the same hash for the same input', () => {
      const code = 'function add(a: number, b: number) { return a + b; }';
      const result1 = normalizeCode(code);
      const result2 = normalizeCode(code);
      expect(result1.normalizedHash).toBe(result2.normalizedHash);
      expect(result1.normalizedHash.length).toBe(64); // SHA256 hex = 64 chars
    });

    it('produces different hashes for different code', () => {
      const code1 = 'function add(a: number, b: number) { return a + b; }';
      const code2 = 'function sub(a: number, b: number) { return a - b; }';
      const result1 = normalizeCode(code1);
      const result2 = normalizeCode(code2);
      // SPEC-GAP: These two have same structure after normalization (both use $VAR_N),
      // but differ in operator (+ vs -), so hashes should differ
      expect(result1.normalizedHash).not.toBe(result2.normalizedHash);
    });
  });

  // ─── Behavior 8: calculateMetrics correctness ───
  describe('normalizeCode — metrics calculation', () => {
    it('returns correct metrics for a known function', () => {
      // SPEC-GAP: calculateMetrics is not directly exported; tested via normalizeCode.
      // Metrics are computed from original code (before normalization).
      const code = [
        'function greet(name: string, greeting: string) {',
        '  if (name) {',
        '    console.log(greeting);',
        '  }',
        '  return name;',
        '}',
      ].join('\n');
      const result = normalizeCode(code);

      // lineCount = 6 non-empty lines
      expect(result.metrics.lineCount).toBe(6);

      // parameterCount: "(name: string, greeting: string)" = 2 params,
      // "(name)" = 1 param, "(greeting)" = 1 param => total depends on all (...) matches
      // SPEC-GAP: parameterCount counts ALL parenthesized groups, not just function signatures
      expect(result.metrics.parameterCount).toBeGreaterThanOrEqual(2);

      // controlFlowDepth: one `if` block = depth from braces
      expect(result.metrics.controlFlowDepth).toBeGreaterThanOrEqual(1);

      // tokenCount: split by whitespace
      expect(result.metrics.tokenCount).toBeGreaterThan(0);
    });
  });

  // ─── Behavior 9: areMetricsSimilar — identical metrics ───
  describe('areMetricsSimilar — identical metrics', () => {
    it('returns true for identical metrics at default threshold', () => {
      const metrics: StructuralMetrics = {
        parameterCount: 3,
        statementCount: 10,
        controlFlowDepth: 2,
        lineCount: 20,
        tokenCount: 50,
      };
      expect(areMetricsSimilar(metrics, metrics)).toBe(true);
    });

    it('returns true for identical metrics at threshold 1.0', () => {
      const metrics: StructuralMetrics = {
        parameterCount: 3,
        statementCount: 10,
        controlFlowDepth: 2,
        lineCount: 20,
        tokenCount: 50,
      };
      expect(areMetricsSimilar(metrics, metrics, 1.0)).toBe(true);
    });
  });

  // ─── Behavior 10: areMetricsSimilar — different metrics ───
  describe('areMetricsSimilar — different metrics', () => {
    it('returns false for wildly different metrics', () => {
      const metrics1: StructuralMetrics = {
        parameterCount: 1,
        statementCount: 2,
        controlFlowDepth: 0,
        lineCount: 3,
        tokenCount: 10,
      };
      const metrics2: StructuralMetrics = {
        parameterCount: 20,
        statementCount: 100,
        controlFlowDepth: 10,
        lineCount: 200,
        tokenCount: 500,
      };
      expect(areMetricsSimilar(metrics1, metrics2)).toBe(false);
    });

    // SPEC-GAP: tokenCount is NOT used in similarity calculation (only param, stmt, depth, line).
    // Spec says "areMetricsSimilar" but doesn't specify which metrics are weighted or how.
    // Implementation uses weighted average: param*0.15 + stmt*0.35 + depth*0.15 + line*0.35.
  });

  // ─── Behavior 11: string literals protect against comment-like content ───
  // Step 1 (string replacement) happens before Step 2 (comment removal),
  // so strings containing "//" or "/*" are protected.
  // NOTE: $STR is mangled to $$VAR_N (see FINDING above), but string content is still removed.
  describe('normalizeCode — string protection from comment removal', () => {
    it('does not lose code after strings containing //', () => {
      const code = 'const url = "https://example.com";\nconst y = 1;';
      const result = normalizeCode(code);
      // String content removed (Step 1 ran before Step 2)
      expect(result.normalizedCode).not.toContain('https://example.com');
      // Both const statements should survive — "https://..." not treated as comment
      expect(result.normalizedCode).toContain('const');
      // "y" should appear as a $VAR placeholder (second const not eaten by comment removal)
      const varMatches = result.normalizedCode.match(/\$VAR_\d+/g) ?? [];
      expect(varMatches.length).toBeGreaterThanOrEqual(2); // at least url and y
    });

    it('does not lose code after strings containing /*', () => {
      const code = 'const pattern = "/* not a comment */";\nconst z = 2;';
      const result = normalizeCode(code);
      expect(result.normalizedCode).not.toContain('not a comment');
      expect(result.normalizedCode).toContain('const');
      // z should survive — not consumed by multi-line comment removal
      const varMatches = result.normalizedCode.match(/\$VAR_\d+/g) ?? [];
      expect(varMatches.length).toBeGreaterThanOrEqual(2);
    });

    it('still removes real comments after string protection', () => {
      const code = 'const url = "https://example.com"; // real comment\nconst x = 1;';
      const result = normalizeCode(code);
      expect(result.normalizedCode).not.toContain('real comment');
      expect(result.normalizedCode).not.toContain('https://example.com');
    });
  });
});
