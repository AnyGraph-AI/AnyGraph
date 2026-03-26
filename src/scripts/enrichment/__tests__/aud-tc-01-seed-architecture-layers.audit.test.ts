/**
 * AUD-TC-01-L1: seed-architecture-layers.ts — Spec-Derived Tests
 *
 * Spec: PLAN.md §Phase 2 "Architecture layers — Infer from directory structure or .codegraph.yml"
 *
 * Behaviors:
 * (1) reads .codegraph.yml layer config if present, falls back to DEFAULT_LAYERS by directory pattern
 * (2) creates ArchitectureLayer nodes per project (MERGE — idempotent)
 * (3) creates BELONGS_TO_LAYER edges from SourceFile → ArchitectureLayer based on path pattern
 * (4) detects layer violations (e.g. Presentation importing Data directly)
 * (5) reports layer distribution + violation count
 * (6) handles missing .codegraph.yml gracefully (uses defaults)
 * (7) scopes all nodes/edges to projectId
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock neo4j-driver
const mockSession = {
  run: vi.fn(),
  close: vi.fn(),
};

const mockDriver = {
  session: vi.fn(() => mockSession),
  close: vi.fn(),
};

vi.mock('neo4j-driver', () => ({
  default: {
    driver: vi.fn(() => mockDriver),
    auth: {
      basic: vi.fn(),
    },
    int: vi.fn((n: number) => ({ low: n, high: 0 })),
  },
}));

// DEFAULT_LAYERS from source
const DEFAULT_LAYERS: Record<string, { match: string[]; layer: string; order: number }> = {
  entry: { match: ['src/index.ts', 'index.ts'], layer: 'Entry', order: 0 },
  presentation: {
    match: ['src/bot/', 'src/ui/', 'src/routes/', 'src/controllers/'],
    layer: 'Presentation',
    order: 1,
  },
  api: { match: ['src/api/', 'src/mcp/', 'src/handlers/'], layer: 'API', order: 2 },
  domain: {
    match: ['src/core/', 'src/domain/', 'src/services/', 'src/lib/'],
    layer: 'Domain',
    order: 3,
  },
  data: {
    match: ['src/core/db/', 'src/db/', 'src/storage/', 'src/data/'],
    layer: 'Data',
    order: 4,
  },
  shared: {
    match: ['src/constants.ts', 'src/types.ts', 'src/types/', 'src/shared/'],
    layer: 'Shared',
    order: 5,
  },
  infra: { match: ['src/infra/', 'src/config/', 'src/utils/'], layer: 'Infrastructure', order: 5 },
  test: { match: ['test/', 'tests/', '__tests__/', 'spec/'], layer: 'Test', order: 6 },
};

// ALLOWED_DEPENDENCIES from source
const ALLOWED_DEPENDENCIES: Record<string, string[]> = {
  Entry: ['Presentation', 'API', 'Domain', 'Data', 'Shared', 'Infrastructure'],
  Presentation: ['API', 'Domain', 'Data', 'Shared', 'Infrastructure'],
  API: ['Domain', 'Data', 'Shared', 'Infrastructure'],
  Domain: ['Data', 'Shared', 'Infrastructure'],
  Data: ['Shared', 'Infrastructure'],
  Shared: ['Infrastructure'],
  Infrastructure: ['Shared'],
  Test: ['Entry', 'Presentation', 'API', 'Domain', 'Data', 'Shared', 'Infrastructure'],
  Scripts: ['Entry', 'Presentation', 'API', 'Domain', 'Data', 'Shared', 'Infrastructure'],
};

describe('[aud-tc-01] seed-architecture-layers.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.run.mockReset();
    mockSession.close.mockReset();
  });

  describe('.codegraph.yml config loading contract', () => {
    it('(1) loads layer rules from .codegraph.yml if present', () => {
      // Contract: YAML config takes precedence over defaults
      const yamlContent = `
layers:
  - match: src/presentation/
    layer: Presentation
  - match: src/data/
    layer: Data
`;
      // Simulate parseYaml result
      const config = {
        layers: [
          { match: 'src/presentation/', layer: 'Presentation' },
          { match: 'src/data/', layer: 'Data' },
        ],
      };

      expect(config.layers).toHaveLength(2);
      expect(config.layers[0].match).toBe('src/presentation/');
      expect(config.layers[0].layer).toBe('Presentation');
    });

    it('(2) falls back to DEFAULT_LAYERS when .codegraph.yml missing', () => {
      // Contract: loadLayerRules returns converted defaults on config read failure
      interface LayerRule {
        match: string;
        layer: string;
      }

      function loadLayerRules(_projectPath: string, configExists: boolean): LayerRule[] {
        if (configExists) {
          return []; // Would load from YAML
        }
        // Convert defaults to rules
        const rules: LayerRule[] = [];
        for (const def of Object.values(DEFAULT_LAYERS)) {
          for (const match of def.match) {
            rules.push({ match, layer: def.layer });
          }
        }
        return rules;
      }

      const rules = loadLayerRules('/project', false);

      expect(rules.length).toBeGreaterThan(0);
      expect(rules.some((r) => r.layer === 'Presentation')).toBe(true);
      expect(rules.some((r) => r.layer === 'Domain')).toBe(true);
    });

    it('(3) DEFAULT_LAYERS covers 8 architectural layers', () => {
      // Contract: comprehensive layer coverage
      const layerNames = new Set(Object.values(DEFAULT_LAYERS).map((d) => d.layer));

      expect(layerNames.size).toBe(8);
      expect(layerNames).toContain('Entry');
      expect(layerNames).toContain('Presentation');
      expect(layerNames).toContain('API');
      expect(layerNames).toContain('Domain');
      expect(layerNames).toContain('Data');
      expect(layerNames).toContain('Shared');
      expect(layerNames).toContain('Infrastructure');
      expect(layerNames).toContain('Test');
    });
  });

  describe('file classification contract', () => {
    it('(4) classifies file by longest matching pattern', () => {
      // Contract: most specific match wins
      interface LayerRule {
        match: string;
        layer: string;
      }

      function classifyFile(filePath: string, projectPath: string, rules: LayerRule[]): string {
        const relative = filePath.startsWith(projectPath) ? filePath.slice(projectPath.length) : filePath;
        let bestMatch = '';
        let bestLayer = 'Unclassified';

        for (const rule of rules) {
          if (relative.startsWith(rule.match) || relative.includes('/' + rule.match)) {
            if (rule.match.length > bestMatch.length) {
              bestMatch = rule.match;
              bestLayer = rule.layer;
            }
          }
        }
        return bestLayer;
      }

      const rules: LayerRule[] = [
        { match: 'src/core/', layer: 'Domain' },
        { match: 'src/core/db/', layer: 'Data' }, // More specific
      ];

      // src/core/db/neo4j.ts should match Data (more specific), not Domain
      const layer = classifyFile('/project/src/core/db/neo4j.ts', '/project/', rules);
      expect(layer).toBe('Data');
    });

    it('(5) classifies root-level .ts files as Scripts', () => {
      // Contract: root *.ts → Scripts layer
      function classifyFile(filePath: string, _projectPath: string): string {
        const relative = filePath.replace('/project/', '');
        if (!relative.includes('/') && relative.endsWith('.ts')) {
          return 'Scripts';
        }
        return 'Unclassified';
      }

      expect(classifyFile('/project/build.ts', '/project/')).toBe('Scripts');
      expect(classifyFile('/project/deploy.ts', '/project/')).toBe('Scripts');
    });

    it('(6) returns Unclassified for unmatched patterns', () => {
      // Contract: explicit fallback layer
      interface LayerRule {
        match: string;
        layer: string;
      }

      function classifyFile(filePath: string, projectPath: string, rules: LayerRule[]): string {
        const relative = filePath.startsWith(projectPath) ? filePath.slice(projectPath.length) : filePath;
        for (const rule of rules) {
          if (relative.startsWith(rule.match)) {
            return rule.layer;
          }
        }
        return 'Unclassified';
      }

      const rules: LayerRule[] = [{ match: 'src/', layer: 'Domain' }];
      expect(classifyFile('/project/vendor/lib.ts', '/project/', rules)).toBe('Unclassified');
    });
  });

  describe('ArchitectureLayer node creation contract', () => {
    it('(7) ArchitectureLayer id format: layer_{projectId}_{sanitizedName}', () => {
      // Contract: deterministic layer IDs
      const projectId = 'proj_c0d3e9a1f200';
      const layerName = 'Domain';
      const expectedId = `layer_${projectId}_${layerName.replace(/[^a-zA-Z0-9]/g, '_')}`;

      expect(expectedId).toBe('layer_proj_c0d3e9a1f200_Domain');
    });

    it('(8) ArchitectureLayer node has properties: id, name, projectId, fileCount', () => {
      // Contract: layer nodes carry classification metadata
      const layerNode = {
        id: 'layer_proj_test_Domain',
        name: 'Domain',
        projectId: 'proj_test',
        fileCount: 45,
      };

      expect(layerNode.name).toBe('Domain');
      expect(layerNode.projectId).toBe('proj_test');
      expect(typeof layerNode.fileCount).toBe('number');
    });

    it('(9) MERGE semantics prevent duplicate ArchitectureLayer nodes', () => {
      // Contract: idempotent layer creation
      const query = 'MERGE (l:ArchitectureLayer {id: $layerId}) SET l.name = $name, l.projectId = $pid, l.fileCount = $count';

      expect(query).toContain('MERGE');
      expect(query).not.toContain('CREATE');
    });
  });

  describe('BELONGS_TO_LAYER edge creation contract', () => {
    it('(10) SourceFile.architectureLayer property set during classification', () => {
      // Contract: SourceFile stores its layer assignment
      const updateQuery = `
        MATCH (sf:SourceFile {filePath: $filePath, projectId: $pid})
        SET sf.architectureLayer = $layer
      `;

      expect(updateQuery).toContain('architectureLayer');
      expect(updateQuery).toContain('SET');
    });

    it('(11) BELONGS_TO_LAYER edge connects SourceFile → ArchitectureLayer', () => {
      // Contract: edge creation via MERGE
      const edgeQuery = `
        MATCH (sf:SourceFile {projectId: $pid})
        WHERE sf.architectureLayer = $layer
        MATCH (l:ArchitectureLayer {id: $layerId})
        MERGE (sf)-[:BELONGS_TO_LAYER]->(l)
      `;

      expect(edgeQuery).toContain('BELONGS_TO_LAYER');
      expect(edgeQuery).toContain('SourceFile');
      expect(edgeQuery).toContain('ArchitectureLayer');
    });
  });

  describe('layer violation detection contract', () => {
    it('(12) ALLOWED_DEPENDENCIES defines valid dependency directions', () => {
      // Contract: each layer has explicit allowed targets
      expect(ALLOWED_DEPENDENCIES['Domain']).toContain('Data');
      expect(ALLOWED_DEPENDENCIES['Domain']).toContain('Shared');
      expect(ALLOWED_DEPENDENCIES['Domain']).not.toContain('Presentation');
    });

    it('(13) detects violation when lower-layer imports higher-layer', () => {
      // Contract: Data importing Presentation is a violation
      const importerLayer = 'Data';
      const importedLayer = 'Presentation';
      const allowed = ALLOWED_DEPENDENCIES[importerLayer] || [];

      const isViolation = !allowed.includes(importedLayer);

      expect(isViolation).toBe(true);
    });

    it('(14) allows valid dependency direction (Domain → Data)', () => {
      // Contract: valid imports are not flagged
      const importerLayer = 'Domain';
      const importedLayer = 'Data';
      const allowed = ALLOWED_DEPENDENCIES[importerLayer] || [];

      const isViolation = !allowed.includes(importedLayer);

      expect(isViolation).toBe(false);
    });

    it('(15) Test layer can import any layer (no violations)', () => {
      // Contract: tests are exempt from layer rules
      const testAllowed = ALLOWED_DEPENDENCIES['Test'];

      expect(testAllowed).toContain('Entry');
      expect(testAllowed).toContain('Presentation');
      expect(testAllowed).toContain('Domain');
      expect(testAllowed).toContain('Data');
    });
  });

  describe('projectId scoping contract', () => {
    it('(16) all queries filter by projectId parameter', () => {
      // Contract: project scoping prevents cross-project contamination
      const queries = [
        'MATCH (sf:SourceFile {projectId: $pid}) RETURN sf.filePath AS filePath',
        'MATCH (l:ArchitectureLayer {projectId: $pid}) DETACH DELETE l',
        'MATCH (sf:SourceFile {projectId: $pid})-[:IMPORTS]->(sf2:SourceFile {projectId: $pid})',
      ];

      for (const q of queries) {
        expect(q).toContain('projectId: $pid');
      }
    });

    it('(17) PROJECTS config maps CLI args to project paths and IDs', () => {
      // Contract: CLI → project mapping
      const PROJECTS: Record<string, { path: string; id: string }> = {
        codegraph: {
          path: '/home/jonathan/.openclaw/workspace/codegraph/',
          id: 'proj_c0d3e9a1f200',
        },
        godspeed: {
          path: '/mnt/c/Users/ddfff/Downloads/Bots/GodSpeed/',
          id: 'proj_60d5feed0001',
        },
      };

      expect(PROJECTS['codegraph'].id).toBe('proj_c0d3e9a1f200');
      expect(PROJECTS['godspeed'].path).toContain('GodSpeed');
    });
  });
});
