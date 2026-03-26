/**
 * AUD-TC-01 Gap-Fill: create-semantic-role-tags.ts — Integration Tests
 *
 * These tests verify ACTUAL graph mutations, not just export contracts.
 * Missing from rf13-semantic-role-tags.spec-test.ts:
 *   (1) loadSemanticRoleMap() loads from config/semantic-role-map.json correctly
 *   (2) enrichSemanticRoleTags() writes semanticRole property to SourceFile nodes in Neo4j
 *   (3) Path > interface > default hierarchy: path match wins over interface match
 *   (4) Full pipeline integration: node gets semanticRole set end-to-end
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createEphemeralGraph, type EphemeralGraphRuntime } from '../../../core/test-harness/ephemeral-graph.js';
import {
  loadSemanticRoleMap,
  enrichSemanticRoleTags,
  assignSemanticRole,
  inferRoleFromPath,
  inferRoleFromInterface,
} from '../create-semantic-role-tags.js';
import path from 'node:path';

describe('[aud-tc-01-gaps] create-semantic-role-tags.ts — Integration', () => {
  let rt: EphemeralGraphRuntime;

  beforeAll(async () => {
    rt = await createEphemeralGraph({ setupSchema: false });
  }, 30_000);

  afterAll(async () => {
    await rt.teardown();
  }, 30_000);

  function toNum(val: unknown): number {
    const v = val as { toNumber?: () => number };
    return typeof v?.toNumber === 'function' ? v.toNumber() : Number(v);
  }

  describe('loadSemanticRoleMap config loading', () => {
    it('(1) loadSemanticRoleMap() loads from config/semantic-role-map.json correctly', async () => {
      const configPath = path.resolve(__dirname, '../../../../config/semantic-role-map.json');
      const roleMap = await loadSemanticRoleMap(configPath);

      // Verify structure
      expect(roleMap).toHaveProperty('version');
      expect(roleMap).toHaveProperty('defaultRole');
      expect(roleMap).toHaveProperty('rules');
      expect(Array.isArray(roleMap.rules)).toBe(true);
      expect(roleMap.rules.length).toBeGreaterThan(0);

      // Verify expected patterns exist
      const patterns = roleMap.rules.map((r) => r.pattern);
      expect(patterns.some((p) => p.includes('parsers'))).toBe(true);
      expect(patterns.some((p) => p.includes('enrichment'))).toBe(true);
    });

    it('(2) loadSemanticRoleMap throws on invalid config', async () => {
      const invalidPath = '/nonexistent/path/semantic-role-map.json';
      await expect(loadSemanticRoleMap(invalidPath)).rejects.toThrow();
    });
  });

  describe('Role assignment hierarchy', () => {
    it('(3) Path > interface > default hierarchy: path match wins over interface match', async () => {
      const roleMap = {
        version: 'test.v1',
        defaultRole: 'unclassified' as const,
        rules: [
          { pattern: '**/src/core/parsers/**', role: 'parser' as const },
          { pattern: '**/src/scripts/enrichment/**', role: 'enrichment' as const },
        ],
      };

      // File with path that matches parser pattern BUT also has Adapter interface
      const filePath = '/repo/src/core/parsers/weird-adapter.ts';
      const sourceCode = 'export class WeirdAdapter {}'; // Would match 'adapter' via interface

      const result = assignSemanticRole(filePath, sourceCode, roleMap);

      // Path match should win
      expect(result.role).toBe('parser');
      expect(result.source).toBe('path');
      expect(result.matchedPattern).toBe('**/src/core/parsers/**');
    });

    it('(4) Interface fallback when path does not match', async () => {
      const roleMap = {
        version: 'test.v1',
        defaultRole: 'unclassified' as const,
        rules: [
          { pattern: '**/src/core/parsers/**', role: 'parser' as const },
        ],
      };

      // File path does NOT match any rule, but has Adapter interface
      const filePath = '/repo/custom/my-adapter.ts';
      const sourceCode = 'export class CustomAdapter {}';

      const result = assignSemanticRole(filePath, sourceCode, roleMap);

      // Interface fallback should kick in
      expect(result.role).toBe('adapter');
      expect(result.source).toBe('interface');
    });

    it('(5) Default role when neither path nor interface matches', async () => {
      const roleMap = {
        version: 'test.v1',
        defaultRole: 'unclassified' as const,
        rules: [
          { pattern: '**/src/core/parsers/**', role: 'parser' as const },
        ],
      };

      const filePath = '/repo/misc/helper.ts';
      const sourceCode = 'export const helper = () => 42;';

      const result = assignSemanticRole(filePath, sourceCode, roleMap);

      expect(result.role).toBe('unclassified');
      expect(result.source).toBe('default');
    });
  });

  describe('Neo4j integration — enrichSemanticRoleTags', () => {
    it('(6) enrichSemanticRoleTags() writes semanticRole property to SourceFile nodes', async () => {
      // Setup: Create SourceFile nodes with known paths
      await rt.run(`
        CREATE (sf1:SourceFile {
          id: $sf1,
          projectId: $projectId,
          filePath: '/repo/src/core/parsers/test-parser.ts',
          name: 'test-parser.ts'
        })
        CREATE (sf2:SourceFile {
          id: $sf2,
          projectId: $projectId,
          filePath: '/repo/src/scripts/enrichment/test-enricher.ts',
          name: 'test-enricher.ts'
        })
        CREATE (sf3:SourceFile {
          id: $sf3,
          projectId: $projectId,
          filePath: '/repo/misc/utils.ts',
          name: 'utils.ts'
        })
      `, {
        projectId: rt.projectId,
        sf1: `${rt.projectId}:sf:parser`,
        sf2: `${rt.projectId}:sf:enricher`,
        sf3: `${rt.projectId}:sf:utils`,
      });

      // Run enrichment with default config
      const configPath = path.resolve(__dirname, '../../../../config/semantic-role-map.json');
      const result = await enrichSemanticRoleTags(rt.driver, {
        projectId: rt.projectId,
        configPath,
      });

      // Verify enrichment ran
      expect(result.tagged).toBe(3);

      // Verify semanticRole set on nodes
      const checkResult = await rt.run(`
        MATCH (sf:SourceFile {projectId: $projectId})
        RETURN sf.filePath AS path, sf.semanticRole AS role, sf.semanticRoleSource AS source
        ORDER BY sf.filePath
      `, { projectId: rt.projectId });

      const roles = checkResult.records.map((r) => ({
        path: r.get('path'),
        role: r.get('role'),
        source: r.get('source'),
      }));

      // Parser file should be tagged as 'parser'
      const parserFile = roles.find((r) => r.path.includes('parsers'));
      expect(parserFile?.role).toBe('parser');
      expect(parserFile?.source).toBe('path');

      // Enrichment file should be tagged as 'enrichment'
      const enricherFile = roles.find((r) => r.path.includes('enrichment'));
      expect(enricherFile?.role).toBe('enrichment');
      expect(enricherFile?.source).toBe('path');
    }, 60_000);

    it('(7) enrichSemanticRoleTags is idempotent — re-run does not duplicate data', async () => {
      // Create a fresh SourceFile
      const sfId = `${rt.projectId}:sf:idem`;
      await rt.run(`
        CREATE (sf:SourceFile {
          id: $sfId,
          projectId: $projectId,
          filePath: '/repo/src/cli/command.ts',
          name: 'command.ts'
        })
      `, { sfId, projectId: rt.projectId });

      const configPath = path.resolve(__dirname, '../../../../config/semantic-role-map.json');

      // Run enrichment twice
      await enrichSemanticRoleTags(rt.driver, { projectId: rt.projectId, configPath });
      await enrichSemanticRoleTags(rt.driver, { projectId: rt.projectId, configPath });

      // Verify only one node exists (no duplicates)
      const countResult = await rt.run(`
        MATCH (sf:SourceFile {id: $sfId})
        RETURN count(sf) AS cnt, sf.semanticRole AS role
      `, { sfId });

      expect(toNum(countResult.records[0]?.get('cnt'))).toBe(1);
      expect(countResult.records[0]?.get('role')).toBe('cli');
    }, 60_000);

    it('(8) Full pipeline: roleDistribution returned correctly', async () => {
      // Setup: Create files with different roles
      const pipelineProjectId = `${rt.projectId}_pipeline`;

      await rt.run(`
        CREATE (sf1:SourceFile {id: $sf1, projectId: $projectId, filePath: '/repo/src/core/parsers/p1.ts', name: 'p1.ts'})
        CREATE (sf2:SourceFile {id: $sf2, projectId: $projectId, filePath: '/repo/src/core/parsers/p2.ts', name: 'p2.ts'})
        CREATE (sf3:SourceFile {id: $sf3, projectId: $projectId, filePath: '/repo/src/scripts/enrichment/e1.ts', name: 'e1.ts'})
        CREATE (sf4:SourceFile {id: $sf4, projectId: $projectId, filePath: '/repo/misc/util.ts', name: 'util.ts'})
      `, {
        projectId: pipelineProjectId,
        sf1: `${pipelineProjectId}:sf:p1`,
        sf2: `${pipelineProjectId}:sf:p2`,
        sf3: `${pipelineProjectId}:sf:e1`,
        sf4: `${pipelineProjectId}:sf:util`,
      });

      const configPath = path.resolve(__dirname, '../../../../config/semantic-role-map.json');
      const result = await enrichSemanticRoleTags(rt.driver, {
        projectId: pipelineProjectId,
        configPath,
      });

      // Verify distribution
      expect(result.tagged).toBe(4);
      expect(result.roleDistribution).toHaveProperty('parser');
      expect(result.roleDistribution['parser']).toBe(2);
      expect(result.roleDistribution).toHaveProperty('enrichment');
      expect(result.roleDistribution['enrichment']).toBe(1);
    }, 60_000);
  });
});
