/**
 * .codegraph.yml config loader
 * 
 * Pluggable framework detection, state roots, critical functions, and layer definitions.
 * Falls back to sensible defaults when no config file exists.
 */
import fs from 'fs';
import path from 'path';

// Use dynamic import for yaml since it might not be installed
let yamlParse: ((content: string) => any) | null = null;

export interface CodeGraphConfig {
  project: {
    repoId: string;
    name?: string;
    include: string[];
    exclude: string[];
  };
  framework?: {
    type: string; // 'grammy' | 'nestjs' | 'express' | 'none'
    /** Registration patterns — maps callee expression to handler type */
    registrations?: Record<string, {
      handlerType: string;
      triggerArgIndex?: number;
    }>;
  };
  state?: {
    /** Root objects whose property accesses create READS_STATE/WRITES_STATE edges */
    roots: string[];  // e.g. ['ctx.session']
  };
  risk?: {
    /** Functions to always mark as CRITICAL regardless of metrics */
    critical?: string[];
    /** Resolution kinds to ignore in risk scoring */
    ignoreResolutionKinds?: string[];
    /** Custom thresholds */
    thresholds?: {
      critical?: number;
      high?: number;
      medium?: number;
    };
  };
  layers?: Record<string, string[]>; // e.g. { domain: ['src/core/'], ui: ['src/bot/'] }
  embeddings?: {
    enabled: boolean;
    model?: string;
  };
}

const DEFAULT_CONFIG: CodeGraphConfig = {
  project: {
    repoId: 'default',
    include: ['src/**/*.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/*.test.ts', '**/*.spec.ts'],
  },
  framework: {
    type: 'none',
  },
  state: {
    roots: [],
  },
  risk: {
    critical: [],
    ignoreResolutionKinds: ['builtin', 'fluent'],
    thresholds: {
      critical: 500,
      high: 100,
      medium: 20,
    },
  },
  embeddings: {
    enabled: true,
    model: 'text-embedding-3-large',
  },
};

/**
 * Load .codegraph.yml from a directory. Falls back to defaults.
 */
export async function loadCodeGraphConfig(repoPath: string): Promise<CodeGraphConfig> {
  const configPaths = [
    path.join(repoPath, '.codegraph.yml'),
    path.join(repoPath, '.codegraph.yaml'),
    path.join(repoPath, 'codegraph.yml'),
    path.join(repoPath, 'codegraph.yaml'),
  ];

  for (const configPath of configPaths) {
    if (fs.existsSync(configPath)) {
      try {
        const content = fs.readFileSync(configPath, 'utf-8');
        const parsed = await parseYaml(content);
        console.log(`Loaded config from ${configPath}`);
        return mergeConfig(DEFAULT_CONFIG, parsed);
      } catch (err) {
        console.warn(`Failed to parse ${configPath}:`, err);
      }
    }
  }

  console.log('No .codegraph.yml found, using defaults');
  return { ...DEFAULT_CONFIG };
}

/**
 * Parse YAML content. Uses yaml package if available, falls back to simple parser.
 */
async function parseYaml(content: string): Promise<any> {
  // Try to load yaml package dynamically
  if (!yamlParse) {
    try {
      const yamlModule = await import('yaml');
      yamlParse = yamlModule.parse;
    } catch {
      // yaml package not installed — use simple fallback
      yamlParse = simpleYamlParse;
    }
  }
  return yamlParse(content);
}

/**
 * Simple YAML parser for basic key-value configs.
 * Handles: scalars, arrays (- item), nested objects (indented keys).
 * Does NOT handle: flow style, anchors, multi-line strings, complex types.
 */
function simpleYamlParse(content: string): any {
  const result: any = {};
  const lines = content.split('\n');
  const stack: { obj: any; indent: number }[] = [{ obj: result, indent: -1 }];

  for (const rawLine of lines) {
    const line = rawLine.replace(/\r$/, '');
    if (line.trim() === '' || line.trim().startsWith('#')) continue;

    const indent = line.search(/\S/);
    const trimmed = line.trim();

    // Pop stack to find parent at correct indent level
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }
    const parent = stack[stack.length - 1].obj;

    // Array item: - value
    if (trimmed.startsWith('- ')) {
      const val = trimmed.slice(2).trim();
      if (Array.isArray(parent)) {
        parent.push(parseValue(val));
      }
      continue;
    }

    // Key-value pair
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) continue;

    const key = trimmed.slice(0, colonIdx).trim();
    const valPart = trimmed.slice(colonIdx + 1).trim();

    if (valPart === '' || valPart === '|' || valPart === '>') {
      // Nested object or upcoming block — create sub-object
      parent[key] = {};
      stack.push({ obj: parent[key], indent });
    } else if (valPart === '[]') {
      parent[key] = [];
    } else {
      parent[key] = parseValue(valPart);
    }
  }

  return result;
}

function parseValue(val: string): any {
  if (val === 'true') return true;
  if (val === 'false') return false;
  if (val === 'null') return null;
  const num = Number(val);
  if (!isNaN(num) && val !== '') return num;
  // Strip quotes
  if ((val.startsWith("'") && val.endsWith("'")) || (val.startsWith('"') && val.endsWith('"'))) {
    return val.slice(1, -1);
  }
  // Simple array: [a, b, c]
  if (val.startsWith('[') && val.endsWith(']')) {
    return val.slice(1, -1).split(',').map(s => parseValue(s.trim()));
  }
  return val;
}

/**
 * Deep merge config with defaults.
 */
function mergeConfig(defaults: CodeGraphConfig, overrides: any): CodeGraphConfig {
  const result = { ...defaults };
  
  if (overrides.project) {
    result.project = { ...defaults.project, ...overrides.project };
  }
  if (overrides.framework) {
    result.framework = { ...defaults.framework, ...overrides.framework };
  }
  if (overrides.state) {
    result.state = { ...defaults.state, ...overrides.state };
  }
  if (overrides.risk) {
    result.risk = { 
      ...defaults.risk, 
      ...overrides.risk,
      thresholds: { ...defaults.risk?.thresholds, ...overrides.risk?.thresholds },
    };
  }
  if (overrides.layers) {
    result.layers = overrides.layers;
  }
  if (overrides.embeddings !== undefined) {
    result.embeddings = { ...defaults.embeddings, ...overrides.embeddings };
  }

  return result;
}

/**
 * Generate a sample .codegraph.yml for a project.
 */
export function generateSampleConfig(repoId: string, framework: string = 'none'): string {
  return `# .codegraph.yml — CodeGraph configuration
# See: https://github.com/drewdrewH/code-graph-context

project:
  repoId: ${repoId}
  include:
    - src/**/*.ts
  exclude:
    - '**/node_modules/**'
    - '**/dist/**'
    - '**/*.test.ts'

framework:
  type: ${framework}

state:
  roots:
    - ctx.session

risk:
  critical: []
  ignoreResolutionKinds:
    - builtin
    - fluent
  thresholds:
    critical: 500
    high: 100
    medium: 20

embeddings:
  enabled: true
  model: text-embedding-3-large
`;
}
