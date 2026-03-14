/**
 * Migration Contract Checks — C1 Lane
 *
 * Ensures that schema changes (new node types, new edge types, property
 * additions/removals) are backward compatible and don't break existing
 * queries or constraints.
 *
 * @see plans/codegraph/TDD_ROADMAP.md — Milestone N3, Migration Contracts
 */

import type { QueryResult } from 'neo4j-driver';

// ============================================================================
// TYPES
// ============================================================================

export interface SchemaSnapshot {
  /** All node labels in the database */
  nodeLabels: string[];
  /** All relationship types in the database */
  relationshipTypes: string[];
  /** All constraint names */
  constraints: string[];
  /** All index names */
  indexes: string[];
  /** Timestamp */
  takenAt: string;
}

export interface MigrationDelta {
  /** Labels added since baseline */
  addedLabels: string[];
  /** Labels removed since baseline */
  removedLabels: string[];
  /** Relationship types added */
  addedRelTypes: string[];
  /** Relationship types removed */
  removedRelTypes: string[];
  /** Constraints added */
  addedConstraints: string[];
  /** Constraints removed (BREAKING) */
  removedConstraints: string[];
  /** Whether any breaking changes were detected */
  hasBreaking: boolean;
  /** Description of breaking changes */
  breakingDetails: string[];
}

// ============================================================================
// CORE
// ============================================================================

/**
 * Take a snapshot of the current database schema.
 */
export async function takeSchemaSnapshot(
  run: (cypher: string, params?: Record<string, unknown>) => Promise<QueryResult>
): Promise<SchemaSnapshot> {
  const labelsResult = await run('CALL db.labels() YIELD label RETURN collect(label) AS labels');
  const relTypesResult = await run('CALL db.relationshipTypes() YIELD relationshipType RETURN collect(relationshipType) AS types');
  const constraintsResult = await run('SHOW CONSTRAINTS YIELD name RETURN collect(name) AS names');
  const indexesResult = await run('SHOW INDEXES YIELD name RETURN collect(name) AS names');

  return {
    nodeLabels: ((labelsResult.records[0]?.get('labels') as string[]) ?? []).sort(),
    relationshipTypes: ((relTypesResult.records[0]?.get('types') as string[]) ?? []).sort(),
    constraints: ((constraintsResult.records[0]?.get('names') as string[]) ?? []).sort(),
    indexes: ((indexesResult.records[0]?.get('names') as string[]) ?? []).sort(),
    takenAt: new Date().toISOString(),
  };
}

/**
 * Compare two schema snapshots and detect migrations.
 * Removals of constraints or relationship types are flagged as breaking.
 */
export function detectMigration(baseline: SchemaSnapshot, current: SchemaSnapshot): MigrationDelta {
  const addedLabels = current.nodeLabels.filter(l => !baseline.nodeLabels.includes(l));
  const removedLabels = baseline.nodeLabels.filter(l => !current.nodeLabels.includes(l));
  const addedRelTypes = current.relationshipTypes.filter(t => !baseline.relationshipTypes.includes(t));
  const removedRelTypes = baseline.relationshipTypes.filter(t => !current.relationshipTypes.includes(t));
  const addedConstraints = current.constraints.filter(c => !baseline.constraints.includes(c));
  const removedConstraints = baseline.constraints.filter(c => !current.constraints.includes(c));

  const breakingDetails: string[] = [];
  if (removedConstraints.length > 0) {
    breakingDetails.push(`Removed constraints: ${removedConstraints.join(', ')}`);
  }
  if (removedRelTypes.length > 0) {
    breakingDetails.push(`Removed relationship types: ${removedRelTypes.join(', ')}`);
  }
  if (removedLabels.length > 0) {
    breakingDetails.push(`Removed labels: ${removedLabels.join(', ')} — may break existing queries`);
  }

  return {
    addedLabels,
    removedLabels,
    addedRelTypes,
    removedRelTypes,
    addedConstraints,
    removedConstraints,
    hasBreaking: breakingDetails.length > 0,
    breakingDetails,
  };
}

/**
 * Assert no breaking migration changes occurred.
 * Throws if constraints or rel types were removed.
 */
export function assertNoBreakingMigration(delta: MigrationDelta): void {
  if (delta.hasBreaking) {
    throw new Error(
      `Breaking schema migration detected!\n` +
      delta.breakingDetails.map(d => `  - ${d}`).join('\n')
    );
  }
}
