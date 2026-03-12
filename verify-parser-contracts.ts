#!/usr/bin/env node
/**
 * Verify parser contract graph integrity.
 *
 * Purpose: enforce M7 parser self-modeling as a done-check gate.
 * Fails if required parser contract stages/edges are missing.
 */

import neo4j from 'neo4j-driver';

interface CheckResult {
  ok: boolean;
  checks: Record<string, boolean>;
  details: Record<string, unknown>;
}

async function run(): Promise<CheckResult> {
  const uri = process.env.NEO4J_URI || 'bolt://localhost:7687';
  const user = process.env.NEO4J_USER || 'neo4j';
  const password = process.env.NEO4J_PASSWORD || 'codegraph';

  const driver = neo4j.driver(uri, neo4j.auth.basic(user, password));
  const session = driver.session();

  try {
    const checks: Record<string, boolean> = {};
    const details: Record<string, unknown> = {};

    // 1) ParserContract nodes must exist
    const totalContracts = await session.run(
      `MATCH (c:ParserContract) RETURN count(c) AS c`,
    );
    const total = Number(totalContracts.records[0]?.get('c')?.toNumber?.() ?? 0);
    checks.contract_nodes_exist = total > 0;
    details.totalContractNodes = total;

    // 2) Plan parser stages must include parse/enrich/materialize
    const stages = await session.run(
      `MATCH (c:ParserContract {parserName: 'plan-parser'})
       RETURN collect(DISTINCT c.stage) AS stages, count(c) AS count`,
    );
    const stageList = (stages.records[0]?.get('stages') as string[] | undefined) ?? [];
    const planParserCount = Number(stages.records[0]?.get('count')?.toNumber?.() ?? 0);
    const mustHaveStages = ['parse', 'enrich', 'materialize'];
    const missingStages = mustHaveStages.filter((s) => !stageList.includes(s));
    checks.plan_parser_required_stages = missingStages.length === 0;
    details.planParserStages = stageList;
    details.planParserContractCount = planParserCount;
    details.missingStages = missingStages;

    // 3) Required contract edge types must exist
    const requiredEdgeTypes = [
      'NEXT_STAGE',
      'EMITS_NODE_TYPE',
      'EMITS_EDGE_TYPE',
      'READS_PLAN_FIELD',
      'MUTATES_TASK_FIELD',
    ];

    const edgeTypeResult = await session.run(
      `MATCH (:ParserContract)-[r]->(:CodeNode)
       RETURN type(r) AS type, count(r) AS count`,
    );

    const edgeCounts: Record<string, number> = {};
    for (const rec of edgeTypeResult.records) {
      edgeCounts[String(rec.get('type'))] = Number(rec.get('count')?.toNumber?.() ?? 0);
    }

    const missingEdgeTypes = requiredEdgeTypes.filter((t) => (edgeCounts[t] ?? 0) === 0);
    checks.required_contract_edge_types = missingEdgeTypes.length === 0;
    details.edgeTypeCounts = edgeCounts;
    details.missingEdgeTypes = missingEdgeTypes;

    // 4) Blast-radius function mapping is present
    const functionMapping = await session.run(
      `MATCH (c:ParserContract {parserName: 'plan-parser'})
       RETURN collect(DISTINCT c.functionName) AS funcs`,
    );
    const funcs = ((functionMapping.records[0]?.get('funcs') as string[] | undefined) ?? []).filter(Boolean);
    const requiredFuncs = ['parsePlanDirectory', 'enrichCrossDomain', 'ingestToNeo4j'];
    const missingFuncs = requiredFuncs.filter((f) => !funcs.includes(f));
    checks.required_function_mapping = missingFuncs.length === 0;
    details.planParserFunctions = funcs;
    details.missingFunctions = missingFuncs;

    const ok = Object.values(checks).every(Boolean);
    return { ok, checks, details };
  } finally {
    await session.close();
    await driver.close();
  }
}

run()
  .then((result) => {
    console.log(JSON.stringify(result));
    process.exit(result.ok ? 0 : 1);
  })
  .catch((error) => {
    console.error(
      JSON.stringify({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    process.exit(1);
  });
