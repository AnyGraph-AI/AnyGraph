/**
 * Virtual dispatch detection — Extension 18
 * 
 * When a CALLS edge targets a method on an interface-typed receiver,
 * the actual implementation could be any class that implements that interface.
 * This script creates POSSIBLE_CALL edges from the caller to all concrete
 * implementations of that interface method.
 * 
 * Also handles abstract class method dispatch.
 * 
 * Usage: npx tsx create-virtual-dispatch-edges.ts
 */
import neo4j from 'neo4j-driver';
import dotenv from 'dotenv';

dotenv.config();

const driver = neo4j.driver(
  process.env.NEO4J_URI || 'bolt://localhost:7687',
  neo4j.auth.basic(
    process.env.NEO4J_USER || 'neo4j',
    process.env.NEO4J_PASSWORD || 'codegraph'
  )
);

async function main() {
  const session = driver.session();
  let totalCreated = 0;

  try {
    // Find CALLS edges where the receiver type matches an Interface name
    // Then find all classes that IMPLEMENTS that interface
    // Create POSSIBLE_CALL from caller → each implementation's matching method
    const result = await session.run(`
      MATCH (caller)-[r:CALLS]->(target:Method)
      WHERE r.context IS NOT NULL AND r.context CONTAINS '"receiverType"'
      WITH caller, target, r,
        apoc.convert.fromJsonMap(r.context) AS ctx
      WHERE ctx.receiverType IS NOT NULL
      MATCH (iface:Interface {name: ctx.receiverType})
      MATCH (impl:Class)-[:IMPLEMENTS]->(iface)
      MATCH (impl)-[:HAS_MEMBER]->(method:Method {name: target.name})
      WHERE NOT (caller)-[:POSSIBLE_CALL]->(method)
      CREATE (caller)-[:POSSIBLE_CALL {
        confidence: 0.7,
        reason: 'virtual-dispatch-via-interface',
        interfaceName: iface.name,
        implementingClass: impl.name,
        source: 'virtual-dispatch-detection',
        createdAt: datetime()
      }]->(method)
      RETURN count(*) AS created
    `);

    const interfaceDispatches = result.records[0]?.get('created')?.toNumber?.() ?? 0;
    totalCreated += interfaceDispatches;
    console.log(`Virtual dispatch via interfaces: ${interfaceDispatches} POSSIBLE_CALL edges`);

    // Same for abstract class methods
    const abstractResult = await session.run(`
      MATCH (caller)-[r:CALLS]->(target:Method)
      WHERE r.context IS NOT NULL AND r.context CONTAINS '"receiverType"'
      WITH caller, target, r,
        apoc.convert.fromJsonMap(r.context) AS ctx
      WHERE ctx.receiverType IS NOT NULL
      MATCH (base:Class {name: ctx.receiverType})
      MATCH (sub:Class)-[:EXTENDS]->(base)
      MATCH (sub)-[:HAS_MEMBER]->(method:Method {name: target.name})
      WHERE NOT (caller)-[:POSSIBLE_CALL]->(method)
      CREATE (caller)-[:POSSIBLE_CALL {
        confidence: 0.7,
        reason: 'virtual-dispatch-via-inheritance',
        baseClass: base.name,
        subClass: sub.name,
        source: 'virtual-dispatch-detection',
        createdAt: datetime()
      }]->(method)
      RETURN count(*) AS created
    `);

    const inheritanceDispatches = abstractResult.records[0]?.get('created')?.toNumber?.() ?? 0;
    totalCreated += inheritanceDispatches;
    console.log(`Virtual dispatch via inheritance: ${inheritanceDispatches} POSSIBLE_CALL edges`);

    console.log(`\n✅ Total POSSIBLE_CALL edges created: ${totalCreated}`);
    if (totalCreated === 0) {
      console.log('   No virtual dispatch detected (no interface/abstract patterns in codebase)');
    }

  } finally {
    await session.close();
    await driver.close();
  }
}

main().catch(console.error);
