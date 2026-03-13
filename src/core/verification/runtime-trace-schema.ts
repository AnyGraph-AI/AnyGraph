import { z } from 'zod';

export const RuntimeTraceNodeTypeSchema = z.enum([
  'Prompt',
  'Decision',
  'ToolCall',
  'Observation',
  'Outcome',
  'PolicyCheck',
  'SessionEpisode',
]);

export const RuntimeTraceEdgeTypeSchema = z.enum([
  'DECIDES',
  'CALLS_TOOL',
  'RETURNS',
  'PRODUCES',
  'ALLOWED_BY',
  'DENIED_BY',
  'ESCALATED_TO',
  'LEADS_TO',
]);

export const PolicyVerdictSchema = z.enum(['allow', 'deny', 'warn', 'escalate', 'unknown']);

export const RuntimeTraceMetadataSchema = z.object({
  sessionKey: z.string().min(1),
  turnId: z.string().min(1),
  timestamp: z.string().datetime(),
  model: z.string().min(1),
  toolName: z.string().min(1).optional(),
  latencyMs: z.number().int().nonnegative().optional(),
  riskScore: z.number().min(0).max(1).optional(),
  policyVerdict: PolicyVerdictSchema.default('unknown'),
});

export const RuntimeRetentionPolicySchema = z.object({
  hotWindowDays: z.number().int().positive().default(14),
  aggregateWindowDays: z.number().int().positive().default(365),
  aggregateBucket: z.enum(['hour', 'day', 'week']).default('day'),
  summarizeAfterDays: z.number().int().positive().default(30),
  dropRawAfterDays: z.number().int().positive().default(90),
});

export const RuntimeTraceEnvelopeSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  nodeType: RuntimeTraceNodeTypeSchema,
  metadata: RuntimeTraceMetadataSchema,
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
});

export type RuntimeTraceNodeType = z.infer<typeof RuntimeTraceNodeTypeSchema>;
export type RuntimeTraceEdgeType = z.infer<typeof RuntimeTraceEdgeTypeSchema>;
export type RuntimeTraceMetadata = z.infer<typeof RuntimeTraceMetadataSchema>;
export type RuntimeRetentionPolicy = z.infer<typeof RuntimeRetentionPolicySchema>;
export type RuntimeTraceEnvelope = z.infer<typeof RuntimeTraceEnvelopeSchema>;

export const DEFAULT_RUNTIME_RETENTION_POLICY: RuntimeRetentionPolicy = RuntimeRetentionPolicySchema.parse({});
