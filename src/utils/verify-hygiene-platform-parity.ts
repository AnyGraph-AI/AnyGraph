import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import crypto from 'node:crypto';

import dotenv from 'dotenv';
import neo4j from 'neo4j-driver';

dotenv.config();

const execFileAsync = promisify(execFile);

const PROJECT_ID = process.env.PROJECT_ID ?? 'proj_c0d3e9a1f200';
const REPO_ROOT = process.env.REPO_ROOT ?? '/home/jonathan/.openclaw/workspace/codegraph';
const DEFAULT_BRANCH = process.env.DEFAULT_BRANCH ?? 'main';
const ENFORCE = String(process.env.HYGIENE_PLATFORM_PARITY_ENFORCE ?? 'false').toLowerCase() === 'true';

function sha(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex').slice(0, 16);
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function getOriginUrl(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['-C', REPO_ROOT, 'remote', 'get-url', 'origin']);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

function parseGithubRepo(origin: string | null): { owner: string; repo: string } | null {
  if (!origin) return null;
  const cleaned = origin.replace(/\.git$/, '');
  const m1 = cleaned.match(/github\.com[:/]([^/]+)\/([^/]+)$/i);
  if (!m1) return null;
  return { owner: m1[1], repo: m1[2] };
}

async function fetchGitHub(endpoint: string): Promise<{ ok: boolean; status?: number; json?: any; error?: string }> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return { ok: false, error: 'GITHUB_TOKEN missing' };
  const url = `https://api.github.com${endpoint}`;
  const res = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'codegraph-hygiene-parity',
    },
  });

  if (!res.ok) {
    return { ok: false, status: res.status, error: await res.text() };
  }
  const json = await res.json();
  return { ok: true, status: res.status, json };
}

async function main(): Promise<void> {
  const driver = neo4j.driver(
    process.env.NEO4J_URI ?? 'bolt://localhost:7687',
    neo4j.auth.basic(process.env.NEO4J_USER ?? 'neo4j', process.env.NEO4J_PASSWORD ?? 'codegraph'),
  );
  const session = driver.session();

  try {
    const codeownersPath = path.join(REPO_ROOT, '.github', 'CODEOWNERS');
    const codeownersExists = await exists(codeownersPath);

    const origin = await getOriginUrl();
    const ghRepo = parseGithubRepo(origin);

    const checks: Record<string, unknown> = {
      codeownersExists,
      origin,
      githubRepoParsed: Boolean(ghRepo),
      branchProtection: 'unknown',
      rulesets: 'unknown',
      requiredStatusChecks: 'unknown',
      requiredReviews: 'unknown',
    };

    if (ghRepo) {
      const bp = await fetchGitHub(`/repos/${ghRepo.owner}/${ghRepo.repo}/branches/${DEFAULT_BRANCH}/protection`);
      if (bp.ok) {
        checks.branchProtection = true;
        checks.requiredStatusChecks = Boolean(bp.json?.required_status_checks);
        checks.requiredReviews = Boolean(bp.json?.required_pull_request_reviews);
      } else if (bp.status === 404) {
        checks.branchProtection = false;
      } else {
        checks.branchProtection = `unavailable:${bp.status ?? 'error'}`;
      }

      const rs = await fetchGitHub(`/repos/${ghRepo.owner}/${ghRepo.repo}/rulesets?includes_parents=true`);
      if (rs.ok) {
        checks.rulesets = Array.isArray(rs.json) ? rs.json.length : 0;
      } else {
        checks.rulesets = `unavailable:${rs.status ?? 'error'}`;
      }
    }

    await session.run(
      `MATCH (v:HygieneViolation {projectId: $projectId, violationType: 'platform_parity'}) DETACH DELETE v`,
      { projectId: PROJECT_ID },
    );

    const violations: Array<{ subtype: string; severity: string; name: string }> = [];
    if (!codeownersExists) {
      violations.push({ subtype: 'missing_codeowners', severity: 'high', name: 'CODEOWNERS missing' });
    }
    if (checks.branchProtection === false) {
      violations.push({ subtype: 'missing_branch_protection', severity: 'high', name: `Branch protection missing for ${DEFAULT_BRANCH}` });
    }

    for (const v of violations) {
      const id = `hygiene-violation:${PROJECT_ID}:platform:${v.subtype}:${sha(v.name)}`;
      await session.run(
        `MERGE (n:CodeNode:HygieneViolation {id: $id})
         SET n.projectId = $projectId,
             n.coreType = 'HygieneViolation',
             n.violationType = 'platform_parity',
             n.subtype = $subtype,
             n.severity = $severity,
             n.mode = 'advisory',
             n.name = $name,
             n.detectedAt = datetime($detectedAt)
         WITH n
         MATCH (c:HygieneControl {projectId: $projectId, code: 'B6'})
         MERGE (n)-[:TRIGGERED_BY]->(c)`,
        {
          id,
          projectId: PROJECT_ID,
          subtype: v.subtype,
          severity: v.severity,
          name: v.name,
          detectedAt: new Date().toISOString(),
        },
      );
    }

    const payload = {
      checks,
      violationsCount: violations.length,
      advisoryMode: !ENFORCE,
      enforce: ENFORCE,
    };

    const snapshotId = `hygiene-metric:${PROJECT_ID}:platform:${Date.now()}`;
    await session.run(
      `MERGE (m:CodeNode:HygieneMetricSnapshot {id: $id})
       SET m.projectId = $projectId,
           m.coreType = 'HygieneMetricSnapshot',
           m.name = 'Platform parity snapshot',
           m.metricFamily = 'platform_parity',
           m.violationsCount = $violationsCount,
           m.payloadJson = $payloadJson,
           m.payloadHash = $payloadHash,
           m.timestamp = datetime($timestamp)
       WITH m
       MATCH (c:HygieneControl {projectId: $projectId, code: 'B6'})
       MERGE (m)-[:MEASURED_BY]->(c)`,
      {
        id: snapshotId,
        projectId: PROJECT_ID,
        violationsCount: violations.length,
        payloadJson: JSON.stringify(payload),
        payloadHash: sha(JSON.stringify(payload)),
        timestamp: new Date().toISOString(),
      },
    );

    const out = {
      ok: ENFORCE ? violations.length === 0 : true,
      projectId: PROJECT_ID,
      advisoryMode: !ENFORCE,
      enforce: ENFORCE,
      checks,
      violations,
      snapshotId,
    };

    const outDir = path.resolve(process.cwd(), 'artifacts', 'hygiene');
    await fs.mkdir(outDir, { recursive: true });
    const outPath = path.join(outDir, `hygiene-platform-parity-${Date.now()}.json`);
    await fs.writeFile(outPath, `${JSON.stringify(out, null, 2)}\n`, 'utf8');

    if (!out.ok) {
      console.error(JSON.stringify({ ...out, artifactPath: outPath }));
      process.exit(1);
    }
    console.log(JSON.stringify({ ...out, artifactPath: outPath }));
  } finally {
    await session.close();
    await driver.close();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  process.exit(1);
});
