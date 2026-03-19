import type { Driver } from 'neo4j-driver';

export class ProjectWriteValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectWriteValidationError';
  }
}

export function extractProjectId(params: Record<string, unknown> = {}): string | undefined {
  const direct = params.projectId ?? params.pid;
  if (typeof direct === 'string' && direct.trim().length > 0) return direct.trim();
  return undefined;
}

export function isProjectScopedWriteQuery(query: string, params: Record<string, unknown> = {}): boolean {
  const hasWriteVerb = /\b(CREATE|MERGE)\b/i.test(query);
  if (!hasWriteVerb) return false;
  return Boolean(extractProjectId(params));
}

export async function validateProjectWrite(driver: Driver, projectId: string): Promise<void> {
  const trimmed = projectId?.trim();
  if (!trimmed) {
    throw new ProjectWriteValidationError('PROJECT_WRITE_BLOCKED: missing projectId for write operation');
  }

  const session = driver.session();
  try {
    const result = await session.run(
      `MATCH (p:Project {projectId: $projectId})
       RETURN coalesce(p.registered, false) AS registered
       LIMIT 1`,
      { projectId: trimmed },
    );

    const registered = result.records[0]?.get('registered');
    const isRegistered = registered === true;

    if (!isRegistered) {
      throw new ProjectWriteValidationError(
        `PROJECT_WRITE_BLOCKED: projectId '${trimmed}' is not registered (Project.registered=true required)`,
      );
    }
  } finally {
    await session.close();
  }
}
