/**
 * GC-7: Create Entrypoint nodes and DISPATCHES_TO edges
 *
 * Scans CodeGraph source files for MCP tool registrations and CLI command
 * registrations, creates Entrypoint nodes and DISPATCHES_TO edges to handlers.
 *
 * MCP patterns:
 *   server.tool(name, description, schema, handler)     — handler at arg[3]
 *   server.registerTool(name, schema, handler)           — handler at arg[2]
 *
 * Commander.js patterns:
 *   program.command(name).description(desc).action(handler)
 *   program.command(name).action(handler)
 *
 * Usage: npx tsx src/scripts/enrichment/create-entrypoint-edges.ts
 */
import neo4j, { type Driver } from 'neo4j-driver';
import { Project, Node, SyntaxKind } from 'ts-morph';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');

function toNum(val: unknown): number {
  if (val === null || val === undefined) return 0;
  if (typeof val === 'number') return val;
  if (typeof val === 'bigint') return Number(val);
  if (typeof val === 'object' && val !== null && 'toNumber' in val) {
    return (val as { toNumber: () => number }).toNumber();
  }
  return Number(val) || 0;
}

function deterministicId(projectId: string, ...parts: string[]): string {
  const hash = createHash('sha256').update([projectId, ...parts].join('::')).digest('hex').slice(0, 16);
  return `${projectId}:Entrypoint:${hash}`;
}

interface EntrypointData {
  name: string;        // e.g. 'tool:self_audit' or 'command:parse' or 'route:GET /users'
  kind: string;        // 'tool' | 'command' | 'route'
  framework: string;   // 'mcp' | 'commander' | 'express' | 'fastify' | 'nest'
  filePath: string;
  startLine: number;
  handlerName?: string;  // name of handler function if identifiable
  handlerFilePath?: string;
}

export function extractMcpRegistrations(project: Project): EntrypointData[] {
  const results: EntrypointData[] = [];

  for (const sourceFile of project.getSourceFiles()) {
    const filePath = sourceFile.getFilePath();
    if (!filePath.includes('/mcp/tools/') && !filePath.includes('/mcp/handlers/')) continue;

    sourceFile.forEachDescendant((node) => {
      if (!Node.isCallExpression(node)) return;

      const expr = node.getExpression();
      if (!Node.isPropertyAccessExpression(expr)) return;

      const methodName = expr.getName();
      const receiver = expr.getExpression();
      if (!Node.isIdentifier(receiver) || receiver.getText() !== 'server') return;

      const args = node.getArguments();

      if (methodName === 'tool' && args.length >= 3) {
        // server.tool(name, description, schema, handler) or server.tool(name, description, handler)
        const nameArg = args[0];
        const toolName = nameArg.getText().replace(/['"]/g, '');
        const handlerArg = args[args.length - 1]; // handler is always last

        results.push({
          name: `tool:${toolName}`,
          kind: 'tool',
          framework: 'mcp',
          filePath,
          startLine: node.getStartLineNumber(),
          handlerName: Node.isIdentifier(handlerArg) ? handlerArg.getText() : undefined,
        });
      } else if (methodName === 'registerTool' && args.length >= 2) {
        // server.registerTool(name, schema, handler) or server.registerTool(name, handler)
        const nameArg = args[0];
        let toolName = nameArg.getText().replace(/['"]/g, '');
        // Handle TOOL_NAMES.xxx references
        if (toolName.startsWith('TOOL_NAMES.')) {
          toolName = toolName.replace('TOOL_NAMES.', '');
        }
        const handlerArg = args[args.length - 1];

        results.push({
          name: `tool:${toolName}`,
          kind: 'tool',
          framework: 'mcp',
          filePath,
          startLine: node.getStartLineNumber(),
          handlerName: Node.isIdentifier(handlerArg) ? handlerArg.getText() : undefined,
        });
      }
    });
  }

  return results;
}

export function extractCommanderRegistrations(project: Project): EntrypointData[] {
  const results: EntrypointData[] = [];

  for (const sourceFile of project.getSourceFiles()) {
    const filePath = sourceFile.getFilePath();
    if (!filePath.includes('/cli/')) continue;

    // Find .command('name').action(handler) chains
    sourceFile.forEachDescendant((node) => {
      if (!Node.isCallExpression(node)) return;

      const expr = node.getExpression();
      if (!Node.isPropertyAccessExpression(expr)) return;
      if (expr.getName() !== 'action') return;

      const args = node.getArguments();
      if (args.length < 1) return;

      const handlerArg = args[0];
      let handlerName: string | undefined = Node.isIdentifier(handlerArg) ? handlerArg.getText() : undefined;
      let handlerFilePath: string | undefined;

      // When handler is an anonymous arrow function, inspect its body for:
      // 1. Dynamic import: await import('../path/module.js') -> resolve to target file's exported fn
      // 2. Direct function call: await runSomething(args) -> extract function name
      if (!handlerName && Node.isArrowFunction(handlerArg)) {
        const body = handlerArg.getBody();
        const calls = body.getDescendantsOfKind(SyntaxKind.CallExpression);

        for (const call of calls) {
          const callExpr = call.getExpression();

          // Pattern 1: dynamic import -> import('../path/to/module.js')
          if (callExpr.getKind() === SyntaxKind.ImportKeyword) {
            const importArgs = call.getArguments();
            if (importArgs.length > 0) {
              const specifier = importArgs[0].getText().replace(/['"]/g, '');
              const resolvedPath = resolve(dirname(filePath), specifier).replace(/\.js$/, '.ts');
              handlerFilePath = resolvedPath;

              // Attempt to find the primary exported function in the target file
              const targetFile = project.getSourceFile(resolvedPath);
              if (targetFile) {
                const exportedFns = targetFile.getFunctions().filter(f => f.isExported() && f.getName());
                handlerName = exportedFns[0]?.getName() ?? 'main';
              } else {
                handlerName = 'main';
              }
            }
            break; // dynamic import found, stop scanning
          }

          // Pattern 2: direct function call -> runRegisterProject(opts.id, opts.name)
          if (Node.isIdentifier(callExpr) && !handlerName) {
            handlerName = callExpr.getText();
          }
        }
      }

      // Walk up the chain to find .command('name')
      let current: Node = expr.getExpression();
      let commandName: string | undefined;

      // Traverse the method chain: program.command('x').description('y').action(fn)
      while (Node.isCallExpression(current)) {
        const innerExpr = current.getExpression();
        if (Node.isPropertyAccessExpression(innerExpr) && innerExpr.getName() === 'command') {
          const cmdArgs = current.getArguments();
          if (cmdArgs.length > 0) {
            commandName = cmdArgs[0].getText().replace(/['"]/g, '').split(' ')[0]; // 'parse <dir>' → 'parse'
          }
          break;
        }
        // Go deeper in the chain
        if (Node.isPropertyAccessExpression(innerExpr)) {
          current = innerExpr.getExpression();
        } else {
          break;
        }
      }

      if (commandName) {
        results.push({
          name: `command:${commandName}`,
          kind: 'command',
          framework: 'commander',
          filePath,
          startLine: node.getStartLineNumber(),
          handlerName,
          handlerFilePath,
        });
      }
    });
  }

  return results;
}

export function extractWebFrameworkRegistrations(project: Project): EntrypointData[] {
  const results: EntrypointData[] = [];
  const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'all']);
  const NEST_DECORATORS = new Set(['Get', 'Post', 'Put', 'Patch', 'Delete', 'Options', 'Head', 'All']);

  for (const sourceFile of project.getSourceFiles()) {
    const filePath = sourceFile.getFilePath();
    if (filePath.includes('node_modules') || filePath.includes('__tests__')) continue;

    sourceFile.forEachDescendant((node) => {
      if (!Node.isCallExpression(node)) return;
      const expr = node.getExpression();
      if (!Node.isPropertyAccessExpression(expr)) return;

      const methodName = expr.getName();
      const receiver = expr.getExpression();
      const args = node.getArguments();

      // Express/Fastify style: app.get('/path', handler), router.post('/x', m1, handler)
      if (HTTP_METHODS.has(methodName.toLowerCase()) && args.length >= 2) {
        const first = args[0];
        const handlerArg = args[args.length - 1];
        const hasPathLikeArg = Node.isStringLiteral(first) || first.getText().startsWith('`/');

        if (hasPathLikeArg) {
          const pathText = first.getText().replace(/[`'"]/g, '');
          const framework = Node.isIdentifier(receiver)
            ? (receiver.getText().toLowerCase().includes('fastify') ? 'fastify' : 'express')
            : 'express';

          results.push({
            name: `route:${methodName.toUpperCase()} ${pathText}`,
            kind: 'route',
            framework,
            filePath,
            startLine: node.getStartLineNumber(),
            handlerName: Node.isIdentifier(handlerArg) ? handlerArg.getText() : undefined,
          });
        }
      }

      // Fastify route object: fastify.route({ method: 'GET', url: '/x', handler })
      if (methodName === 'route' && args.length >= 1 && Node.isObjectLiteralExpression(args[0])) {
        const obj = args[0];
        const methodProp = obj.getProperty('method');
        const urlProp = obj.getProperty('url');
        const handlerProp = obj.getProperty('handler');

        const methodText = methodProp && Node.isPropertyAssignment(methodProp)
          ? methodProp.getInitializer()?.getText().replace(/[`'"]/g, '')
          : 'ROUTE';
        const urlText = urlProp && Node.isPropertyAssignment(urlProp)
          ? urlProp.getInitializer()?.getText().replace(/[`'"]/g, '')
          : '/';

        let handlerName: string | undefined;
        if (handlerProp && Node.isPropertyAssignment(handlerProp)) {
          const init = handlerProp.getInitializer();
          if (init && Node.isIdentifier(init)) handlerName = init.getText();
        }

        results.push({
          name: `route:${(methodText ?? 'ROUTE').toUpperCase()} ${urlText ?? '/'}`,
          kind: 'route',
          framework: 'fastify',
          filePath,
          startLine: node.getStartLineNumber(),
          handlerName,
        });
      }
    });

    // NestJS decorators: @Controller('/base') + @Get('/child')
    for (const cls of sourceFile.getClasses()) {
      const controller = cls.getDecorator('Controller');
      if (!controller) continue;

      const controllerPath = controller.getArguments()[0]?.getText()?.replace(/[`'"]/g, '') ?? '';

      for (const method of cls.getMethods()) {
        for (const deco of method.getDecorators()) {
          const dName = deco.getName();
          if (!NEST_DECORATORS.has(dName)) continue;

          const routeArg = deco.getArguments()[0]?.getText()?.replace(/[`'"]/g, '') ?? '';
          const fullPath = `${controllerPath}/${routeArg}`.replace(/\/+/g, '/');

          results.push({
            name: `route:${dName.toUpperCase()} ${fullPath === '' ? '/' : fullPath}`,
            kind: 'route',
            framework: 'nest',
            filePath,
            startLine: method.getStartLineNumber(),
            handlerName: method.getName(),
          });
        }
      }
    }
  }

  return results;
}

export async function enrichEntrypointEdges(driver: Driver): Promise<{
  entrypoints: number;
  dispatchEdges: number;
}> {
  const projectId = 'proj_c0d3e9a1f200';

  // Step 1: Scan source with ts-morph
  console.log('[GC-7] Scanning source files for entrypoint registrations...');
  const tsMorphProject = new Project({
    tsConfigFilePath: resolve(ROOT, 'tsconfig.json'),
    skipAddingFilesFromTsConfig: false,
  });

  const mcpEntrypoints = extractMcpRegistrations(tsMorphProject);
  const cliEntrypoints = extractCommanderRegistrations(tsMorphProject);
  const webEntrypoints = extractWebFrameworkRegistrations(tsMorphProject);
  const allEntrypoints = [...mcpEntrypoints, ...cliEntrypoints, ...webEntrypoints];

  console.log(`[GC-7] Found ${mcpEntrypoints.length} MCP + ${cliEntrypoints.length} CLI + ${webEntrypoints.length} web-framework entrypoints`);

  if (allEntrypoints.length === 0) {
    return { entrypoints: 0, dispatchEdges: 0 };
  }

  // Step 2: Create Entrypoint nodes in Neo4j
  const session = driver.session();
  try {
    let entrypointCount = 0;
    let dispatchCount = 0;

    for (const ep of allEntrypoints) {
      const epId = deterministicId(projectId, ep.kind, ep.name, ep.filePath);

      // Create Entrypoint node
      await session.run(
        `MERGE (e:Entrypoint:CodeNode {id: $id})
         ON CREATE SET
           e.projectId = $projectId,
           e.name = $name,
           e.coreType = 'FunctionDeclaration',
           e.filePath = $filePath,
           e.startLine = $startLine,
           e.endLine = $startLine,
           e.entrypointKind = $kind,
           e.framework = $framework,
           e.createdAt = toString(datetime())
         ON MATCH SET
           e.name = $name,
           e.entrypointKind = $kind,
           e.framework = $framework
         RETURN e.id AS id`,
        {
          id: epId,
          projectId,
          name: ep.name,
          filePath: ep.filePath,
          startLine: ep.startLine,
          kind: ep.kind,
          framework: ep.framework,
        },
      );
      entrypointCount++;

      // Step 3: Create DISPATCHES_TO edge to the containing function/variable
      // Match any CodeNode (Function, Variable, Method) in the same file that contains this line
      // Many MCP tools are arrow functions assigned to exported const variables
      const dispatchResult = await session.run(
        `MATCH (e:Entrypoint {id: $epId})
         MATCH (fn:CodeNode {projectId: $projectId, filePath: $filePath})
         WHERE (fn:Function OR fn:Variable OR fn:Method)
           AND fn.startLine <= $startLine AND fn.endLine >= $startLine
         WITH e, fn
         ORDER BY (fn.endLine - fn.startLine) ASC
         LIMIT 1
         MERGE (e)-[r:DISPATCHES_TO]->(fn)
         ON CREATE SET
           r.derived = true,
           r.source = 'entrypoint-enrichment',
           r.projectId = $projectId,
           r.framework = $framework,
           r.kind = $kind
         ON MATCH SET
           r.projectId = $projectId
         RETURN count(r) AS cnt`,
        {
          epId,
          projectId,
          filePath: ep.filePath,
          startLine: ep.startLine,
          framework: ep.framework,
          kind: ep.kind,
        },
      );
      const dispatchedByLine = toNum(dispatchResult.records[0]?.get('cnt'));
      dispatchCount += dispatchedByLine;

      // Step 3b: For entries with named handlers that weren't matched by line range,
      // try matching by handler name (Commander.js uses named references at module scope)
      let namedCount = 0;
      if (ep.handlerName && dispatchedByLine === 0) {
        const namedResult = await session.run(
          `MATCH (e:Entrypoint {id: $epId})
           MATCH (fn:CodeNode {projectId: $projectId})
           WHERE (fn:Function OR fn:Variable OR fn:Method)
             AND fn.name = $handlerName
           WITH e, fn LIMIT 1
           MERGE (e)-[r:DISPATCHES_TO]->(fn)
           ON CREATE SET
             r.derived = true,
             r.source = 'entrypoint-enrichment',
             r.projectId = $projectId,
             r.framework = $framework,
             r.kind = $kind,
             r.matchedBy = 'handlerName'
           ON MATCH SET
             r.projectId = $projectId
           RETURN count(r) AS cnt`,
          {
            epId,
            projectId,
            handlerName: ep.handlerName,
            framework: ep.framework,
            kind: ep.kind,
          },
        );
        namedCount = toNum(namedResult.records[0]?.get('cnt'));
        dispatchCount += namedCount;
      }

      // Step 3c: For dynamic-import handlers, fall back to matching by the resolved
      // target file path when the handler name lookup (Step 3b) found nothing.
      // Picks the first exported function in the target file by start line.
      if (ep.handlerFilePath && dispatchedByLine === 0 && namedCount === 0) {
        const filePathResult = await session.run(
          `MATCH (e:Entrypoint {id: $epId})
           MATCH (fn:CodeNode {projectId: $projectId, filePath: $handlerFilePath})
           WHERE (fn:Function OR fn:Variable OR fn:Method)
           WITH e, fn
           ORDER BY fn.startLine ASC
           LIMIT 1
           MERGE (e)-[r:DISPATCHES_TO]->(fn)
           ON CREATE SET
             r.derived = true,
             r.source = 'entrypoint-enrichment',
             r.projectId = $projectId,
             r.framework = $framework,
             r.kind = $kind,
             r.matchedBy = 'handlerFilePath'
           ON MATCH SET
             r.projectId = $projectId
           RETURN count(r) AS cnt`,
          {
            epId,
            projectId,
            handlerFilePath: ep.handlerFilePath,
            framework: ep.framework,
            kind: ep.kind,
          },
        );
        dispatchCount += toNum(filePathResult.records[0]?.get('cnt'));
      }
    }

    console.log(`[GC-7] ${entrypointCount} Entrypoint nodes, ${dispatchCount} DISPATCHES_TO edges`);
    return { entrypoints: entrypointCount, dispatchEdges: dispatchCount };
  } finally {
    await session.close();
  }
}

// Direct execution
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('create-entrypoint-edges.ts')) {
  const driver = neo4j.driver('bolt://localhost:7687', neo4j.auth.basic('neo4j', 'codegraph'));
  enrichEntrypointEdges(driver)
    .then((result) => {
      console.log(`[GC-7] Done: ${JSON.stringify(result)}`);
      process.exit(0);
    })
    .catch((err) => {
      console.error('[GC-7] Error:', err);
      process.exit(1);
    })
    .finally(() => driver.close());
}
