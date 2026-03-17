/**
 * GC-8: Create Field nodes for mutable state
 *
 * Detects mutable class properties and file-scope let/var variables via ts-morph.
 * Creates Field nodes and READS_STATE/WRITES_STATE edges using reference analysis.
 *
 * Scope v1: mutable class properties + file-scope let/var only.
 * No interprocedural alias reasoning.
 *
 * Usage: npx tsx src/scripts/enrichment/create-state-field-nodes.ts
 */
import neo4j, { type Driver } from 'neo4j-driver';
import { Project, Node, SyntaxKind, Scope } from 'ts-morph';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');

export function toNum(val: unknown): number {
  if (val === null || val === undefined) return 0;
  if (typeof val === 'number') return val;
  if (typeof val === 'bigint') return Number(val);
  if (typeof val === 'object' && val !== null && 'toNumber' in val) {
    return (val as { toNumber: () => number }).toNumber();
  }
  return Number(val) || 0;
}

export function fieldId(projectId: string, filePath: string, className: string | null, name: string): string {
  const hash = createHash('sha256')
    .update([projectId, filePath, className ?? '__module__', name].join('::'))
    .digest('hex')
    .slice(0, 16);
  return `${projectId}:Field:${hash}`;
}

interface FieldData {
  name: string;
  filePath: string;
  className: string | null;  // null for module-scope variables
  startLine: number;
  endLine: number;
  mutable: boolean;
  kind: 'class-property' | 'module-var';
  typeName?: string;
  hasInitializer: boolean;
}

interface StateAccess {
  fieldId: string;
  accessorName: string;  // function/method name
  accessorFilePath: string;
  accessorStartLine: number;
  isWrite: boolean;
}

export function extractMutableFields(project: Project): FieldData[] {
  const fields: FieldData[] = [];

  for (const sourceFile of project.getSourceFiles()) {
    const filePath = sourceFile.getFilePath();
    if (filePath.includes('node_modules') || filePath.includes('__tests__') || filePath.includes('.test.')) continue;

    // 1. Mutable class properties
    for (const cls of sourceFile.getClasses()) {
      const className = cls.getName() ?? 'AnonymousClass';
      for (const prop of cls.getProperties()) {
        const scope = prop.getScope();
        // Include private/protected/public mutable properties
        const isReadonly = prop.isReadonly();
        const isStatic = prop.isStatic();
        if (isReadonly) continue;  // Only mutable state

        fields.push({
          name: prop.getName(),
          filePath,
          className,
          startLine: prop.getStartLineNumber(),
          endLine: prop.getEndLineNumber(),
          mutable: true,
          kind: 'class-property',
          typeName: prop.getType()?.getText()?.slice(0, 100),
          hasInitializer: prop.hasInitializer(),
        });
      }
    }

    // 2. Module-scope let/var variables (mutable state at file scope)
    for (const varStmt of sourceFile.getVariableStatements()) {
      for (const decl of varStmt.getDeclarations()) {
        const declarationKind = varStmt.getDeclarationKind();
        if (declarationKind === 'const') continue;  // Only mutable (let/var)

        // Only top-level (file-scope)
        if (decl.getFirstAncestorByKind(SyntaxKind.FunctionDeclaration) ||
            decl.getFirstAncestorByKind(SyntaxKind.ArrowFunction) ||
            decl.getFirstAncestorByKind(SyntaxKind.MethodDeclaration)) {
          continue;
        }

        fields.push({
          name: decl.getName(),
          filePath,
          className: null,
          startLine: decl.getStartLineNumber(),
          endLine: decl.getEndLineNumber(),
          mutable: true,
          kind: 'module-var',
          typeName: decl.getType()?.getText()?.slice(0, 100),
          hasInitializer: decl.hasInitializer(),
        });
      }
    }
  }

  return fields;
}

export function extractStateAccess(project: Project, fields: FieldData[], projectId: string): StateAccess[] {
  const accesses: StateAccess[] = [];
  const fieldMap = new Map<string, FieldData>();

  for (const f of fields) {
    const key = f.className ? `${f.className}.${f.name}` : `__module__:${f.filePath}:${f.name}`;
    fieldMap.set(key, f);
  }

  // For class properties: find references via ts-morph
  for (const sourceFile of project.getSourceFiles()) {
    const filePath = sourceFile.getFilePath();
    if (filePath.includes('node_modules') || filePath.includes('__tests__')) continue;

    for (const cls of sourceFile.getClasses()) {
      const className = cls.getName() ?? 'AnonymousClass';

      for (const method of cls.getMethods()) {
        const methodName = method.getName();
        const methodBody = method.getBody()?.getText() ?? '';

        // Check which class fields are accessed
        for (const prop of cls.getProperties()) {
          if (prop.isReadonly()) continue;
          const propName = prop.getName();
          const key = `${className}.${propName}`;
          const field = fieldMap.get(key);
          if (!field) continue;

          const fId = fieldId(projectId, field.filePath, field.className, field.name);

          // Simple heuristic: check for `this.propName =` (write) or `this.propName` (read)
          const writePattern = new RegExp(`this\\.${propName}\\s*[=!](?!=)`, 'g');
          const readPattern = new RegExp(`this\\.${propName}\\b`, 'g');

          const writes = methodBody.match(writePattern);
          const reads = methodBody.match(readPattern);

          if (writes && writes.length > 0) {
            accesses.push({
              fieldId: fId,
              accessorName: methodName,
              accessorFilePath: filePath,
              accessorStartLine: method.getStartLineNumber(),
              isWrite: true,
            });
          }
          if (reads && reads.length > (writes?.length ?? 0)) {
            // More reads than writes means there's read access beyond just writes
            accesses.push({
              fieldId: fId,
              accessorName: methodName,
              accessorFilePath: filePath,
              accessorStartLine: method.getStartLineNumber(),
              isWrite: false,
            });
          }
        }
      }
    }
  }

  return accesses;
}

export async function enrichStateFieldNodes(driver: Driver): Promise<{
  fieldNodes: number;
  stateEdges: number;
}> {
  const projectId = 'proj_c0d3e9a1f200';

  console.log('[GC-8] Scanning source files for mutable state...');
  const tsMorphProject = new Project({
    tsConfigFilePath: resolve(ROOT, 'tsconfig.json'),
    skipAddingFilesFromTsConfig: false,
  });

  const fields = extractMutableFields(tsMorphProject);
  console.log(`[GC-8] Found ${fields.length} mutable fields (${fields.filter(f => f.kind === 'class-property').length} class, ${fields.filter(f => f.kind === 'module-var').length} module)`);

  if (fields.length === 0) {
    return { fieldNodes: 0, stateEdges: 0 };
  }

  const session = driver.session();
  try {
    let fieldCount = 0;
    let edgeCount = 0;

    // Step 1: Create Field nodes
    for (const f of fields) {
      const fId = fieldId(projectId, f.filePath, f.className, f.name);

      await session.run(
        `MERGE (field:Field:CodeNode {id: $id})
         ON CREATE SET
           field.projectId = $projectId,
           field.name = $name,
           field.coreType = 'Field',
           field.filePath = $filePath,
           field.startLine = $startLine,
           field.endLine = $endLine,
           field.className = $className,
           field.fieldKind = $fieldKind,
           field.typeName = $typeName,
           field.mutable = true,
           field.hasInitializer = $hasInit,
           field.createdAt = toString(datetime())
         ON MATCH SET
           field.typeName = $typeName,
           field.mutable = true
         RETURN field.id`,
        {
          id: fId,
          projectId,
          name: f.name,
          filePath: f.filePath,
          startLine: f.startLine,
          endLine: f.endLine,
          className: f.className,
          fieldKind: f.kind,
          typeName: f.typeName ?? null,
          hasInit: f.hasInitializer,
        },
      );
      fieldCount++;

      // Link Field to its parent class or SourceFile via CONTAINS
      if (f.className) {
        await session.run(
          `MATCH (field:Field {id: $fieldId})
           MATCH (cls:Class {projectId: $projectId, name: $className, filePath: $filePath})
           MERGE (cls)-[r:HAS_FIELD]->(field)
           ON CREATE SET r.derived = true, r.source = 'state-field-enrichment', r.projectId = $projectId
           ON MATCH SET r.projectId = $projectId`,
          { fieldId: fId, projectId, className: f.className, filePath: f.filePath },
        );
      } else {
        await session.run(
          `MATCH (field:Field {id: $fieldId})
           MATCH (sf:SourceFile {projectId: $projectId, filePath: $filePath})
           MERGE (sf)-[r:CONTAINS]->(field)
           ON CREATE SET r.derived = true, r.source = 'state-field-enrichment', r.projectId = $projectId
           ON MATCH SET r.projectId = $projectId`,
          { fieldId: fId, projectId, filePath: f.filePath },
        );
      }
    }

    // Step 2: Analyze state access and create READS_STATE/WRITES_STATE edges
    const accesses = extractStateAccess(tsMorphProject, fields, projectId);
    console.log(`[GC-8] Found ${accesses.length} state accesses (${accesses.filter(a => a.isWrite).length} writes, ${accesses.filter(a => !a.isWrite).length} reads)`);

    for (const access of accesses) {
      const edgeType = access.isWrite ? 'WRITES_STATE' : 'READS_STATE';

      const result = await session.run(
        `MATCH (field:Field {id: $fieldId})
         MATCH (fn:CodeNode {projectId: $projectId, filePath: $filePath})
         WHERE (fn:Function OR fn:Method OR fn:Variable)
           AND fn.name = $fnName
         WITH field, fn LIMIT 1
         MERGE (fn)-[r:${edgeType}]->(field)
         ON CREATE SET r.derived = true, r.source = 'state-field-enrichment'
         RETURN count(r) AS cnt`,
        {
          fieldId: access.fieldId,
          projectId,
          filePath: access.accessorFilePath,
          fnName: access.accessorName,
        },
      );
      edgeCount += toNum(result.records[0]?.get('cnt'));
    }

    console.log(`[GC-8] ${fieldCount} Field nodes, ${edgeCount} state edges`);
    return { fieldNodes: fieldCount, stateEdges: edgeCount };
  } finally {
    await session.close();
  }
}

// Direct execution
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('create-state-field-nodes.ts')) {
  const driver = neo4j.driver('bolt://localhost:7687', neo4j.auth.basic('neo4j', 'codegraph'));
  enrichStateFieldNodes(driver)
    .then((r) => { console.log(`[GC-8] Done: ${JSON.stringify(r)}`); process.exit(0); })
    .catch((e) => { console.error('[GC-8] Error:', e); process.exit(1); })
    .finally(() => driver.close());
}
