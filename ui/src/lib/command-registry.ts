export type CommandCategory = 'Core' | 'Verification' | 'Planning' | 'Utilities';

export type CommandTargetType = 'SourceFile' | 'Function' | 'Task';

export type CommandDefinition = {
  id: string;
  title: string;
  description: string;
  command: string;
  category: CommandCategory;
  docsUrl?: string;
};

export const COMMAND_REGISTRY: CommandDefinition[] = [
  {
    id: 'parse-project',
    title: 'Parse project',
    description: 'Re-parse and ingest the current code project graph.',
    command: 'cd codegraph && codegraph parse . --project-id proj_c0d3e9a1f200',
    category: 'Core',
  },
  {
    id: 'enforce-edit',
    title: 'Run enforcement gate',
    description: 'Check gate status for changed files before commit.',
    command: 'cd codegraph && codegraph enforce /absolute/path/to/file.ts --mode enforced',
    category: 'Core',
  },
  {
    id: 'self-diagnosis',
    title: 'Run self-diagnosis',
    description: 'Execute architecture and integrity diagnosis checks.',
    command: 'cd codegraph && npm run self-diagnosis',
    category: 'Verification',
  },
  {
    id: 'probe-architecture',
    title: 'Probe architecture',
    description: 'Run architecture probe suite.',
    command: 'cd codegraph && npm run probe-architecture',
    category: 'Verification',
  },
  {
    id: 'done-check',
    title: 'Run done-check',
    description: 'Execute full governance/integrity closure gate.',
    command: 'cd codegraph && npm run done-check',
    category: 'Verification',
  },
  {
    id: 'plan-refresh',
    title: 'Refresh plan graph',
    description: 'Recompute plan evidence/linkage and drift status.',
    command: 'cd codegraph && npm run plan:refresh',
    category: 'Planning',
  },
  {
    id: 'rebuild-derived',
    title: 'Rebuild derived edges',
    description: 'Nuke and regenerate derived graph relationships.',
    command: 'cd codegraph && npm run rebuild-derived',
    category: 'Utilities',
  },
  {
    id: 'graph-metrics',
    title: 'Record graph metrics snapshot',
    description: 'Capture current graph snapshot for trend monitoring.',
    command: 'cd codegraph && npm run graph:metrics',
    category: 'Utilities',
  },
];

export function contextualCommands(type: CommandTargetType, value: string): CommandDefinition[] {
  const escaped = value.replace(/"/g, '\\"');

  if (type === 'SourceFile') {
    return [
      {
        id: 'context-enforce-file',
        title: `Gate check: ${value}`,
        description: 'Run enforcement gate for this file.',
        command: `cd codegraph && npx tsx src/scripts/entry/enforce-edit.ts "${escaped}" --mode enforced`,
        category: 'Core',
      },
    ];
  }

  if (type === 'Function') {
    return [
      {
        id: 'context-function-callers',
        title: `Find callers: ${value}`,
        description: 'Query callers of this function in Neo4j.',
        command:
          `cypher-shell -u neo4j -p codegraph "MATCH (caller)-[:CALLS]->(f:Function {name:'${escaped}'}) RETURN caller.name, caller.filePath"`,
        category: 'Utilities',
      },
    ];
  }

  return [
    {
      id: 'context-task-evidence',
      title: `Task evidence: ${value}`,
      description: 'Show code evidence linked to this task.',
      command:
        `cypher-shell -u neo4j -p codegraph "MATCH (t:Task {name:'${escaped}'})-[:HAS_CODE_EVIDENCE]->(e) RETURN labels(e), e.name, e.filePath LIMIT 50"`,
      category: 'Planning',
    },
  ];
}

export function commandsByCategory(): Record<CommandCategory, CommandDefinition[]> {
  return COMMAND_REGISTRY.reduce(
    (acc, command) => {
      acc[command.category].push(command);
      return acc;
    },
    {
      Core: [] as CommandDefinition[],
      Verification: [] as CommandDefinition[],
      Planning: [] as CommandDefinition[],
      Utilities: [] as CommandDefinition[],
    },
  );
}
