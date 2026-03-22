/**
 * Tests for asset-import classification in create-unresolved-nodes.ts
 *
 * Verifies that CSS/image/font/JSON imports starting with '.' are classified
 * as 'asset-import' instead of 'local-module-not-found'. This prevents false
 * positives in integrity:verify's unresolved local reference count.
 *
 * Regression test for: globals.css in ui/src/app/layout.tsx was incorrectly
 * classified as local-module-not-found, causing integrity:verify to fail.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import neo4j, { Driver } from 'neo4j-driver';

const PROJECT_ID = 'proj_c0d3e9a1f200';

describe('Asset import classification (create-unresolved-nodes)', () => {
  let driver: Driver;

  beforeAll(() => {
    driver = neo4j.driver(
      'bolt://localhost:7687',
      neo4j.auth.basic('neo4j', 'codegraph'),
    );
  });

  afterAll(async () => {
    await driver.close();
  });

  it('classifies ./globals.css as asset-import, not local-module-not-found', async () => {
    const session = driver.session();
    try {
      const result = await session.run(
        `MATCH (u:UnresolvedReference {projectId: $pid})
         WHERE u.rawText = './globals.css'
         RETURN u.reason AS reason`,
        { pid: PROJECT_ID },
      );
      expect(result.records.length).toBeGreaterThan(0);
      expect(result.records[0].get('reason')).toBe('asset-import');
    } finally {
      await session.close();
    }
  });

  it('no local-module-not-found for any CSS/SCSS/image/font imports', async () => {
    const session = driver.session();
    try {
      const result = await session.run(
        `MATCH (u:UnresolvedReference {projectId: $pid, reason: 'local-module-not-found'})
         WHERE u.rawText ENDS WITH '.css'
            OR u.rawText ENDS WITH '.scss'
            OR u.rawText ENDS WITH '.sass'
            OR u.rawText ENDS WITH '.less'
            OR u.rawText ENDS WITH '.svg'
            OR u.rawText ENDS WITH '.png'
            OR u.rawText ENDS WITH '.jpg'
            OR u.rawText ENDS WITH '.gif'
            OR u.rawText ENDS WITH '.webp'
            OR u.rawText ENDS WITH '.woff'
            OR u.rawText ENDS WITH '.woff2'
            OR u.rawText ENDS WITH '.json'
         RETURN u.rawText AS rawText, u.reason AS reason`,
        { pid: PROJECT_ID },
      );
      expect(result.records).toHaveLength(0);
    } finally {
      await session.close();
    }
  });

  it('zero local-module-not-found references in project', async () => {
    const session = driver.session();
    try {
      const result = await session.run(
        `MATCH (u:UnresolvedReference {projectId: $pid, reason: 'local-module-not-found'})
         RETURN count(u) AS cnt`,
        { pid: PROJECT_ID },
      );
      const count = result.records[0].get('cnt').toNumber();
      expect(count).toBe(0);
    } finally {
      await session.close();
    }
  });

  it('asset-import nodes exist for known asset extensions', async () => {
    const session = driver.session();
    try {
      const result = await session.run(
        `MATCH (u:UnresolvedReference {projectId: $pid, reason: 'asset-import'})
         RETURN count(u) AS cnt`,
        { pid: PROJECT_ID },
      );
      const count = result.records[0].get('cnt').toNumber();
      expect(count).toBeGreaterThan(0);
    } finally {
      await session.close();
    }
  });
});
