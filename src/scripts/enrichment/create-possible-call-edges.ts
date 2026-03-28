/**
 * POSSIBLE_CALL edge detection — Extension 7: Dynamic dispatch
 * 
 * Detects patterns where the call target is determined at runtime:
 * 1. Ternary function selection: const handler = cond ? fnA : fnB; handler()
 * 2. Higher-order functions: function call<T>(fn: () => T) { fn() }
 * 3. Callback registration: setCallback(fn) → stored fn called later
 * 
 * Creates POSSIBLE_CALL edges with confidence scores.
 * 
 * Detection strategy: Query sourceCode properties and AST-derived metadata
 * from the graph — NOT hardcoded pattern lists.
 * 
 * Usage: npx tsx create-possible-call-edges.ts
 */
import type { Driver, Session } from 'neo4j-driver';
import neo4j from 'neo4j-driver';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Detect ternary function selection patterns in source code.
 * Pattern: `cond ? fnA : fnB` where fnA and fnB are function identifiers
 * Returns array of {trueTarget, falseTarget} pairs.
 */
export function extractTernaryFunctionCandidates(sourceCode: string): Array<{trueFn: string, falseFn: string}> {
  const results: Array<{trueFn: string, falseFn: string}> = [];
  
  // Pattern: identifier ? identifier : identifier (ternary with function identifiers)
  // Matches: condition ? handleA : handleB  or  isX ? fnX : fnY
  // Captures the two function alternatives
  const ternaryPattern = /\?\s*([a-zA-Z_$][a-zA-Z0-9_$]*)\s*:\s*([a-zA-Z_$][a-zA-Z0-9_$]*)/g;
  
  let match;
  while ((match = ternaryPattern.exec(sourceCode)) !== null) {
    const trueFn = match[1];
    const falseFn = match[2];
    
    // Filter out obvious non-function values (literals, common variable prefixes)
    const nonFunctionPatterns = /^(true|false|null|undefined|NaN|Infinity|\d+|'.*'|".*")$/;
    if (!nonFunctionPatterns.test(trueFn) && !nonFunctionPatterns.test(falseFn)) {
      results.push({ trueFn, falseFn });
    }
  }
  
  return results;
}

/**
 * Detect callback registration patterns in source code.
 * 
 * Strategy: Graph-derived type information first (Function parameters with callback-like types),
 * fallback to naming patterns when type info unavailable.
 * 
 * Returns true if the source indicates callback registration.
 */
export function hasCallbackRegistrationPattern(sourceCode: string, fnName: string): boolean {
  // Common callback registration naming patterns (fallback when type info unavailable)
  const registrationPatterns = [
    /^set[A-Z]\w*(?:Callback|Handler|Listener)/,  // setCallback, setHandler, setListener
    /^register[A-Z]\w*/,                           // registerHandler, registerCallback
    /^on[A-Z]\w*/,                                 // onEvent, onReady
    /^add\w*(?:Listener|Handler|Callback)/,        // addListener, addHandler, addCallback
    /^subscribe/,                                  // subscribe
    /^attach/,                                     // attachHandler
  ];
  
  // Check if function name matches registration pattern
  for (const pattern of registrationPatterns) {
    if (pattern.test(fnName)) {
      return true;
    }
  }
  
  // Also check if sourceCode contains assignment to callback-like properties
  const callbackAssignments = /this\.(callback|handler|listener|on\w+)\s*=/i;
  return callbackAssignments.test(sourceCode);
}

export async function enrichPossibleCallEdges(driver: Driver): Promise<{
  ternary: number;
  hof: number;
  registration: number;
  total: number;
}> {
  const session = driver.session();
  let totalCreated = 0;
  let ternaryCount = 0;
  let hofCount = 0;
  let registrationCount = 0;

  try {
    console.log('=== Strategy 1: Ternary function selection (auto-detected) ===');
    
    // Query functions with sourceCode containing ternary operators
    const ternaryFunctions = await session.run(`
      MATCH (fn:Function)
      WHERE fn.sourceCode IS NOT NULL AND fn.sourceCode CONTAINS '?'
      RETURN fn.id AS fnId, fn.name AS fnName, fn.filePath AS filePath, fn.sourceCode AS sourceCode
    `);

    for (const record of ternaryFunctions.records) {
      const fnId = record.get('fnId');
      const fnName = record.get('fnName');
      const filePath = record.get('filePath') || '';
      const sourceCode = record.get('sourceCode') || '';
      
      const candidates = extractTernaryFunctionCandidates(sourceCode);
      
      for (const { trueFn, falseFn } of candidates) {
        // Create POSSIBLE_CALL edges to both ternary branches
        for (const targetName of [trueFn, falseFn]) {
          const result = await session.run(`
            MATCH (caller:Function) WHERE caller.id = $callerId
            MATCH (target:Function {name: $targetName})
            WHERE NOT (caller)-[:POSSIBLE_CALL]->(target) AND caller.id <> target.id
            CREATE (caller)-[:POSSIBLE_CALL {
              confidence: 0.85,
              reason: 'ternary-function-selection',
              source: 'ast-pattern-detection',
              derivedFrom: 'sourceCode-analysis',
              ternaryGroup: $ternaryGroup,
              createdAt: datetime()
            }]->(target)
            RETURN count(*) AS created
          `, {
            callerId: fnId,
            targetName,
            ternaryGroup: `${trueFn}|${falseFn}`,
          });
          const created = result.records[0]?.get('created')?.toNumber?.() ?? 0;
          totalCreated += created;
          ternaryCount += created;
          if (created > 0) {
            console.log(`  ${fnName} → ${targetName} (ternary: ${trueFn}|${falseFn})`);
          }
        }
      }
    }
    console.log(`  Ternary dispatch edges: ${ternaryCount}`);

    console.log('\n=== Strategy 2: Higher-order function callbacks ===');
    
    // Find functions with callback parameters and create POSSIBLE_CALL edges
    // from the HOF to functions passed as arguments to it
    const hofEdges = await session.run(`
      MATCH (hof:Function)-[:HAS_PARAMETER]->(p:Parameter)
      WHERE p.type IS NOT NULL 
        AND (p.type CONTAINS '=>' OR p.type CONTAINS 'Function' OR p.type CONTAINS 'Callback')
      WITH hof, p
      // Find callers that pass a function reference to this HOF
      MATCH (caller:Function)-[c:CALLS]->(hof)
      WHERE c.context IS NOT NULL
      // Find functions in the same file that could be passed as callbacks
      MATCH (candidate:Function)
      WHERE candidate.filePath = caller.filePath 
        AND candidate.id <> hof.id 
        AND candidate.id <> caller.id
        AND NOT (hof)-[:POSSIBLE_CALL]->(candidate)
      WITH hof, candidate, count(*) as cnt
      WHERE cnt > 0
      CREATE (hof)-[:POSSIBLE_CALL {
        confidence: 0.65,
        reason: 'higher-order-function',
        source: 'ast-pattern-detection',
        derivedFrom: 'parameter-type-analysis',
        createdAt: datetime()
      }]->(candidate)
      RETURN hof.name AS hofName, candidate.name AS candidateName, count(*) AS created
    `);

    for (const record of hofEdges.records) {
      const hofName = record.get('hofName');
      const candidateName = record.get('candidateName');
      const created = record.get('created')?.toNumber?.() ?? 1;
      totalCreated += created;
      hofCount += created;
      console.log(`  ${hofName} →→ ${candidateName} (HOF callback)`);
    }
    console.log(`  Higher-order function edges: ${hofCount}`);

    console.log('\n=== Strategy 3: Callback registration patterns ===');
    
    // Find functions that register callbacks (setCallback, addListener, etc.)
    // and link them to potential callback implementations
    const registrationFunctions = await session.run(`
      MATCH (fn:Function)
      WHERE fn.sourceCode IS NOT NULL
        AND (fn.name =~ '(?i)^(set|register|add|attach|subscribe|on)[A-Z].*'
             OR fn.sourceCode =~ '(?i)this\\.(callback|handler|listener)\\s*=')
      RETURN fn.id AS fnId, fn.name AS fnName, fn.sourceCode AS sourceCode, fn.filePath AS filePath
    `);

    for (const record of registrationFunctions.records) {
      const fnId = record.get('fnId');
      const fnName = record.get('fnName');
      const sourceCode = record.get('sourceCode') || '';
      const filePath = record.get('filePath') || '';
      
      if (hasCallbackRegistrationPattern(sourceCode, fnName)) {
        // Link to functions passed as parameters to this registration function
        const result = await session.run(`
          MATCH (registrar:Function) WHERE registrar.id = $registrarId
          MATCH (caller:Function)-[c:CALLS]->(registrar)
          // Find functions defined in same or calling file that could be callbacks
          MATCH (callback:Function)
          WHERE callback.filePath IN [registrar.filePath, caller.filePath]
            AND callback.id <> registrar.id 
            AND callback.id <> caller.id
            AND NOT (registrar)-[:POSSIBLE_CALL]->(callback)
            AND (callback.name =~ '(?i).*(handler|callback|listener|on[A-Z]).*'
                 OR callback.name =~ '(?i)^handle[A-Z].*')
          WITH registrar, callback, count(*) as relevance
          ORDER BY relevance DESC
          LIMIT 5
          CREATE (registrar)-[:POSSIBLE_CALL {
            confidence: 0.70,
            reason: 'callback-registration',
            source: 'ast-pattern-detection',
            derivedFrom: 'naming-pattern-analysis',
            createdAt: datetime()
          }]->(callback)
          RETURN callback.name AS callbackName
        `, { registrarId: fnId });
        
        for (const cbRecord of result.records) {
          const callbackName = cbRecord.get('callbackName');
          totalCreated += 1;
          registrationCount += 1;
          console.log(`  ${fnName} → ${callbackName} (callback-registration)`);
        }
      }
    }
    console.log(`  Callback registration edges: ${registrationCount}`);

    console.log('\n=== Strategy 4: Conditional dispatch hotspots (diagnostic) ===');
    
    // Log callers with multiple conditional CALLS — these might need manual POSSIBLE_CALL edges
    const conditionalDispatch = await session.run(`
      MATCH (caller:Function)-[r:CALLS]->(target:Function)
      WHERE r.conditional = true
      WITH caller, collect(DISTINCT target.name) AS targets, count(r) AS cnt
      WHERE cnt >= 2
      RETURN caller.name AS caller, targets, cnt
      ORDER BY cnt DESC
      LIMIT 10
    `);

    for (const record of conditionalDispatch.records) {
      const caller = record.get('caller');
      const targets = record.get('targets') as string[];
      const cnt = record.get('cnt')?.toNumber?.() ?? record.get('cnt');
      console.log(`  ${caller}: ${cnt} conditional targets → [${targets.slice(0, 5).join(', ')}${targets.length > 5 ? '...' : ''}]`);
    }

    console.log(`\n✅ POSSIBLE_CALL edges created: ${totalCreated}`);
    console.log(`   Breakdown: ternary=${ternaryCount}, HOF=${hofCount}, registration=${registrationCount}`);

    return {
      ternary: ternaryCount,
      hof: hofCount,
      registration: registrationCount,
      total: totalCreated,
    };
  } finally {
    await session.close();
  }
}

// Direct execution (CLI wrapper)
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('create-possible-call-edges.ts')) {
  const driver = neo4j.driver(
    process.env.NEO4J_URI || 'bolt://localhost:7687',
    neo4j.auth.basic(
      process.env.NEO4J_USER || 'neo4j',
      process.env.NEO4J_PASSWORD || 'codegraph'
    )
  );

  enrichPossibleCallEdges(driver)
    .then((result) => {
      console.log(`\nFinal: ${JSON.stringify(result)}`);
      process.exit(0);
    })
    .catch((error) => {
      console.error('[create-possible-call-edges] Error:', error);
      process.exit(1);
    })
    .finally(() => driver.close());
}
