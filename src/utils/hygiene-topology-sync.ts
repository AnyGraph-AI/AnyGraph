import dotenv from 'dotenv';
import neo4j from 'neo4j-driver';

dotenv.config();

const PROJECT_ID = process.env.PROJECT_ID ?? 'proj_c0d3e9a1f200';
const PROFILE_ID = `repo-hygiene-profile:${PROJECT_ID}:code-repo-default`;
const TOPOLOGY_VERSION = 'v1';

const PATH_CLASSES: Array<{ key: string; patterns: string[] }> = [
  { key: 'source', patterns: ['src/**'] },
  { key: 'tests', patterns: ['test/**', 'tests/**', '**/*.spec.ts', '**/*.test.ts'] },
  { key: 'docs', patterns: ['docs/**', '*.md'] },
  { key: 'scripts', patterns: ['scripts/**', '*.ts'] },
  { key: 'ops', patterns: ['.github/**', 'config/**'] },
  { key: 'artifacts', patterns: ['artifacts/**'] },
  { key: 'generated', patterns: ['dist/**', 'build/**', 'coverage/**'] },
  { key: 'third_party', patterns: ['node_modules/**'] },
];

const ALLOWED_EXTENSIONS = [
  '.ts', '.js', '.mjs', '.cjs', '.json', '.md', '.yml', '.yaml', '.sh', '.txt', '.gitignore', '.CODEOWNERS', '.env', '.example', '.lock',
];

const FORBIDDEN_PATTERNS = ['**/.DS_Store', '**/Thumbs.db', '**/*.pem'];
const DEPRECATED_PATTERNS = ['src/src/**'];

async function main(): Promise<void> {
  const driver = neo4j.driver(
    process.env.NEO4J_URI ?? 'bolt://localhost:7687',
    neo4j.auth.basic(process.env.NEO4J_USER ?? 'neo4j', process.env.NEO4J_PASSWORD ?? 'codegraph'),
  );
  const session = driver.session();
  const nowIso = new Date().toISOString();

  try {
    await session.run(
      `MATCH (m:TopologyManifest {projectId: $projectId}) DETACH DELETE m`,
      { projectId: PROJECT_ID },
    );

    await session.run(
      `MERGE (m:CodeNode:TopologyManifest {id: $id})
       SET m.projectId = $projectId,
           m.coreType = 'TopologyManifest',
           m.name = 'Repository topology contract',
           m.version = $version,
           m.pathClassKeys = $pathClassKeys,
           m.pathClassesJson = $pathClassesJson,
           m.allowedExtensions = $allowedExtensions,
           m.forbiddenPatterns = $forbiddenPatterns,
           m.deprecatedPatterns = $deprecatedPatterns,
           m.maxPathLength = $maxPathLength,
           m.maxSourceFileBytes = $maxSourceFileBytes,
           m.updatedAt = datetime($updatedAt)
       WITH m
       MATCH (p:RepoHygieneProfile {id: $profileId})
       MERGE (p)-[:DEFINES_TOPOLOGY]->(m)`,
      {
        id: `topology-manifest:${PROJECT_ID}:${TOPOLOGY_VERSION}`,
        projectId: PROJECT_ID,
        version: TOPOLOGY_VERSION,
        pathClassKeys: PATH_CLASSES.map((p) => p.key),
        pathClassesJson: JSON.stringify(PATH_CLASSES),
        allowedExtensions: ALLOWED_EXTENSIONS,
        forbiddenPatterns: FORBIDDEN_PATTERNS,
        deprecatedPatterns: DEPRECATED_PATTERNS,
        maxPathLength: Number(process.env.HYGIENE_MAX_PATH_LENGTH ?? '180'),
        maxSourceFileBytes: Number(process.env.HYGIENE_MAX_SOURCE_FILE_BYTES ?? '1048576'),
        updatedAt: nowIso,
        profileId: PROFILE_ID,
      },
    );

    await session.run(
      `MATCH (d:HygieneDomain {id: $domainId})
       MATCH (m:TopologyManifest {projectId: $projectId})
       MERGE (d)-[:DEFINES_TOPOLOGY]->(m)`,
      { projectId: PROJECT_ID, domainId: `hygiene-domain:${PROJECT_ID}` },
    );

    console.log(
      JSON.stringify({
        ok: true,
        projectId: PROJECT_ID,
        profileId: PROFILE_ID,
        topologyVersion: TOPOLOGY_VERSION,
        pathClassCount: PATH_CLASSES.length,
        forbiddenPatternCount: FORBIDDEN_PATTERNS.length,
        deprecatedPatternCount: DEPRECATED_PATTERNS.length,
      }),
    );
  } finally {
    await session.close();
    await driver.close();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  process.exit(1);
});
