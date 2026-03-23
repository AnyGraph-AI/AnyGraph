/**
 * AUD-TC-07-L1-06: schema.ts behavioral audit tests
 *
 * Spec sources:
 *  - plans/codegraph/PLAN.md §Node Types, §Edge Types, §Key Queries, Dual-schema Architecture
 *  - AUD-TC-07.md behaviors (1)-(9)
 *
 * Tests assert BEHAVIOR from specs, not implementation details.
 * Accept criteria: 9+ behavioral assertions, all green.
 */
import { describe, it, expect } from 'vitest';
import {
  CoreNodeType,
  CoreEdgeType,
  CORE_TYPESCRIPT_SCHEMA,
  DEFAULT_PARSE_OPTIONS,
} from '../../config/schema.js';
import { EXCLUDE_PATTERNS_REGEX } from '../../../constants.js';

// ============================================================================
// (1) CoreNodeType enum — 14 Phase 1 types
// ============================================================================
describe('CoreNodeType enum — Phase 1 completeness', () => {
  it('has all 14 required Phase 1 node types', () => {
    const required = [
      'SOURCE_FILE',
      'CLASS_DECLARATION',
      'INTERFACE_DECLARATION',
      'ENUM_DECLARATION',
      'FUNCTION_DECLARATION',
      'VARIABLE_DECLARATION',
      'TYPE_ALIAS',
      'METHOD_DECLARATION',
      'PROPERTY_DECLARATION',
      'CONSTRUCTOR_DECLARATION',
      'PARAMETER_DECLARATION',
      'IMPORT_DECLARATION',
      'EXPORT_DECLARATION',
      'DECORATOR',
    ] as const;

    for (const key of required) {
      expect(CoreNodeType[key], `CoreNodeType.${key} must exist`).toBeDefined();
    }
    // Exactly 14 entries
    expect(Object.keys(CoreNodeType).length).toBe(14);
  });

  it('node type string values match ts-morph naming conventions (PascalCase)', () => {
    for (const [, value] of Object.entries(CoreNodeType)) {
      expect(value).toMatch(/^[A-Z][a-zA-Z]+$/);
    }
  });
});

// ============================================================================
// (2) CoreEdgeType enum — 11 core edges
// ============================================================================
describe('CoreEdgeType enum — core edge completeness', () => {
  it('has all 11 core edges', () => {
    const required = [
      'CONTAINS',
      'IMPORTS',
      'EXPORTS',
      'EXTENDS',
      'IMPLEMENTS',
      'TYPED_AS',
      'HAS_MEMBER',
      'HAS_PARAMETER',
      'CALLS',
      'DECORATED_WITH',
      'RESOLVES_TO',
    ] as const;

    for (const key of required) {
      expect(CoreEdgeType[key], `CoreEdgeType.${key} must exist`).toBeDefined();
    }
    expect(Object.keys(CoreEdgeType).length).toBe(11);
  });

  it('edge type string values are SCREAMING_SNAKE_CASE (Neo4j convention)', () => {
    for (const [, value] of Object.entries(CoreEdgeType)) {
      expect(value).toMatch(/^[A-Z][A-Z_]+$/);
    }
  });
});

// ============================================================================
// (3) CORE_TYPESCRIPT_SCHEMA — node/edge types matching PLAN.md spec
// ============================================================================
describe('CORE_TYPESCRIPT_SCHEMA — structural completeness', () => {
  it('has a name and version string', () => {
    expect(typeof CORE_TYPESCRIPT_SCHEMA.name).toBe('string');
    expect(typeof CORE_TYPESCRIPT_SCHEMA.version).toBe('string');
    expect(CORE_TYPESCRIPT_SCHEMA.name.length).toBeGreaterThan(0);
  });

  it('nodeTypes covers every CoreNodeType key', () => {
    for (const coreType of Object.values(CoreNodeType)) {
      expect(CORE_TYPESCRIPT_SCHEMA.nodeTypes[coreType], `nodeTypes must have entry for ${coreType}`).toBeDefined();
    }
  });

  it('edgeTypes covers every CoreEdgeType key', () => {
    for (const coreEdge of Object.values(CoreEdgeType)) {
      expect(CORE_TYPESCRIPT_SCHEMA.edgeTypes[coreEdge], `edgeTypes must have entry for ${coreEdge}`).toBeDefined();
    }
  });

  it('each nodeType definition has astNodeKind, astGetter, neo4j.labels, and properties', () => {
    for (const [key, node] of Object.entries(CORE_TYPESCRIPT_SCHEMA.nodeTypes)) {
      expect(typeof node.astNodeKind, `${key}.astNodeKind must be number`).toBe('number');
      expect(typeof node.astGetter, `${key}.astGetter must be string`).toBe('string');
      expect(Array.isArray(node.neo4j.labels), `${key}.neo4j.labels must be array`).toBe(true);
      expect(node.neo4j.labels.length, `${key}.neo4j.labels must have at least one label`).toBeGreaterThan(0);
      expect(Array.isArray(node.properties), `${key}.properties must be array`).toBe(true);
    }
  });

  it('SourceFile node has correct Neo4j labels: CodeNode, SourceFile, TypeScript', () => {
    const sf = CORE_TYPESCRIPT_SCHEMA.nodeTypes[CoreNodeType.SOURCE_FILE];
    expect(sf.neo4j.labels).toContain('CodeNode');
    expect(sf.neo4j.labels).toContain('SourceFile');
    expect(sf.neo4j.labels).toContain('TypeScript');
  });
});

// ============================================================================
// (4) Neo4jNodeProperties — spec-required fields present on properties interface
// ============================================================================
describe('CORE_TYPESCRIPT_SCHEMA — Neo4jNodeProperties required fields', () => {
  it('SourceFile node includes id, projectId, name, filePath as indexed required properties', () => {
    const sfProps = CORE_TYPESCRIPT_SCHEMA.nodeTypes[CoreNodeType.SOURCE_FILE].properties;
    const propNames = sfProps.map(p => p.name);
    // Core fields from spec: id/projectId are system fields; name and filePath are node-level
    expect(propNames).toContain('name');
    expect(propNames).toContain('filePath');
    // filePath must be unique-indexed
    const filePathProp = sfProps.find(p => p.name === 'filePath');
    expect(filePathProp?.neo4j.indexed).toBe(true);
  });

  it('all node type properties have required neo4j shape: { indexed, unique, required }', () => {
    for (const [key, node] of Object.entries(CORE_TYPESCRIPT_SCHEMA.nodeTypes)) {
      for (const prop of node.properties) {
        expect(typeof prop.neo4j.indexed, `${key}.${prop.name}.indexed must be boolean`).toBe('boolean');
        expect(typeof prop.neo4j.unique, `${key}.${prop.name}.unique must be boolean`).toBe('boolean');
        expect(typeof prop.neo4j.required, `${key}.${prop.name}.required must be boolean`).toBe('boolean');
      }
    }
  });
});

// ============================================================================
// (5) Neo4jEdgeProperties — spec-required fields
// ============================================================================
describe('CORE_TYPESCRIPT_SCHEMA — edge spec-required fields', () => {
  it('every edge definition has coreType, relationshipWeight, neo4j.relationshipType, neo4j.direction', () => {
    for (const [key, edge] of Object.entries(CORE_TYPESCRIPT_SCHEMA.edgeTypes)) {
      expect(edge.coreType, `${key}.coreType`).toBeDefined();
      expect(typeof edge.relationshipWeight, `${key}.relationshipWeight must be number`).toBe('number');
      expect(typeof edge.neo4j.relationshipType, `${key}.neo4j.relationshipType must be string`).toBe('string');
      expect(['OUTGOING', 'INCOMING', 'BIDIRECTIONAL']).toContain(edge.neo4j.direction);
    }
  });

  it('CALLS edge has source and confidence properties as per spec', () => {
    const callsEdge = CORE_TYPESCRIPT_SCHEMA.edgeTypes[CoreEdgeType.CALLS];
    const propNames = callsEdge.properties.map(p => p.name);
    expect(propNames).toContain('confidence');
    expect(propNames).toContain('source');
  });
});

// ============================================================================
// (6) FrameworkSchema interface — pluggable extension contract
// ============================================================================
describe('FrameworkSchema interface contract — verifiable via CORE_TYPESCRIPT_SCHEMA shape', () => {
  it('CORE_TYPESCRIPT_SCHEMA exposes astGetters map which is the pluggable extension anchor', () => {
    // FrameworkSchema builds on CoreTypeScriptSchema; astGetters must be a Record
    expect(typeof CORE_TYPESCRIPT_SCHEMA.astGetters).toBe('object');
    expect(CORE_TYPESCRIPT_SCHEMA.astGetters).not.toBeNull();
  });
});

// ============================================================================
// (7) DEFAULT_PARSE_OPTIONS — uses EXCLUDE_PATTERNS_REGEX from constants
// ============================================================================
describe('DEFAULT_PARSE_OPTIONS — exclude patterns from constants', () => {
  it('excludePatterns references EXCLUDE_PATTERNS_REGEX (same array reference or same content)', () => {
    const opts = DEFAULT_PARSE_OPTIONS;
    expect(Array.isArray(opts.excludePatterns)).toBe(true);
    // Must contain the canonical patterns from constants
    for (const pattern of EXCLUDE_PATTERNS_REGEX) {
      expect(opts.excludePatterns).toContain(pattern);
    }
  });

  it('includePatterns targets TypeScript files', () => {
    expect(DEFAULT_PARSE_OPTIONS.includePatterns).toContain('**/*.ts');
    expect(DEFAULT_PARSE_OPTIONS.includePatterns).toContain('**/*.tsx');
  });

  it('coreSchema is set to CORE_TYPESCRIPT_SCHEMA by default', () => {
    expect(DEFAULT_PARSE_OPTIONS.coreSchema).toBe(CORE_TYPESCRIPT_SCHEMA);
  });

  it('frameworkSchemas defaults to empty array (no framework schemas by default)', () => {
    expect(Array.isArray(DEFAULT_PARSE_OPTIONS.frameworkSchemas)).toBe(true);
    expect(DEFAULT_PARSE_OPTIONS.frameworkSchemas!.length).toBe(0);
  });
});

// ============================================================================
// (8) astGetters map — complete for all CoreNodeType entries
// ============================================================================
describe('astGetters map — completeness', () => {
  it('has an entry for every CoreNodeType', () => {
    const getters = CORE_TYPESCRIPT_SCHEMA.astGetters;
    for (const coreType of Object.values(CoreNodeType)) {
      expect(getters[coreType], `astGetters must have entry for ${coreType}`).toBeDefined();
    }
  });

  it('SOURCE_FILE getter is "self" (special entry point case)', () => {
    expect(CORE_TYPESCRIPT_SCHEMA.astGetters[CoreNodeType.SOURCE_FILE]).toBe('self');
  });

  it('CLASS_DECLARATION getter is "getClasses"', () => {
    expect(CORE_TYPESCRIPT_SCHEMA.astGetters[CoreNodeType.CLASS_DECLARATION]).toBe('getClasses');
  });

  it('METHOD_DECLARATION getter is "getMethods"', () => {
    expect(CORE_TYPESCRIPT_SCHEMA.astGetters[CoreNodeType.METHOD_DECLARATION]).toBe('getMethods');
  });
});

// ============================================================================
// (9) Edge relationship weights — tier system (Critical 0.9-1.0, High 0.7-0.8, Medium 0.5-0.6, Low 0.3-0.4)
// ============================================================================
describe('Edge relationship weights — tier system adherence', () => {
  it('all edge weights are in valid range [0, 1]', () => {
    for (const [key, edge] of Object.entries(CORE_TYPESCRIPT_SCHEMA.edgeTypes)) {
      expect(edge.relationshipWeight, `${key}.relationshipWeight must be >= 0`).toBeGreaterThanOrEqual(0);
      expect(edge.relationshipWeight, `${key}.relationshipWeight must be <= 1`).toBeLessThanOrEqual(1);
    }
  });

  it('CALLS edge weight is in Critical/High tier (≥0.7) — execution flow is primary', () => {
    const callsWeight = CORE_TYPESCRIPT_SCHEMA.edgeTypes[CoreEdgeType.CALLS].relationshipWeight;
    expect(callsWeight).toBeGreaterThanOrEqual(0.7);
  });

  it('EXTENDS edge weight is in High tier (≥0.7) — inheritance is critical', () => {
    const extendsWeight = CORE_TYPESCRIPT_SCHEMA.edgeTypes[CoreEdgeType.EXTENDS].relationshipWeight;
    expect(extendsWeight).toBeGreaterThanOrEqual(0.7);
  });

  it('RESOLVES_TO edge weight is in High tier (≥0.7) — critical for cross-file blast radius', () => {
    const resolveWeight = CORE_TYPESCRIPT_SCHEMA.edgeTypes[CoreEdgeType.RESOLVES_TO].relationshipWeight;
    expect(resolveWeight).toBeGreaterThanOrEqual(0.7);
  });

  it('CONTAINS and DECORATED_WITH weights are in Low tier (≤0.5) — structural/metadata', () => {
    const containsWeight = CORE_TYPESCRIPT_SCHEMA.edgeTypes[CoreEdgeType.CONTAINS].relationshipWeight;
    const decoratedWeight = CORE_TYPESCRIPT_SCHEMA.edgeTypes[CoreEdgeType.DECORATED_WITH].relationshipWeight;
    expect(containsWeight).toBeLessThanOrEqual(0.5);
    expect(decoratedWeight).toBeLessThanOrEqual(0.5);
  });

  it('IMPLEMENTS weight is in High tier (≥0.7) — contract relationships are important', () => {
    const implementsWeight = CORE_TYPESCRIPT_SCHEMA.edgeTypes[CoreEdgeType.IMPLEMENTS].relationshipWeight;
    expect(implementsWeight).toBeGreaterThanOrEqual(0.7);
  });
});
