import { z } from 'zod';

/**
 * Parser Meta-Graph Contracts
 *
 * Models parser internals as first-class graph contracts so parser refactors
 * can be queried for blast radius and regression impact.
 */

export const ParserStageTypeSchema = z.enum([
  'parse',
  'normalize',
  'enrich',
  'materialize',
  'verify',
]);

export const ParserContractNodeSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  parserName: z.string().min(1),
  stage: ParserStageTypeSchema,
  name: z.string().min(1),
  sourcePath: z.string().min(1).optional(),
  functionName: z.string().min(1).optional(),
  emitsNodeTypes: z.array(z.string()).default([]),
  emitsEdgeTypes: z.array(z.string()).default([]),
  readsPlanFields: z.array(z.string()).default([]),
  mutatesTaskFields: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1).default(1),
  createdAt: z.string().datetime().optional(),
});

export const ParserContractEdgeSchema = z.object({
  type: z.enum([
    'NEXT_STAGE',
    'EMITS_NODE_TYPE',
    'EMITS_EDGE_TYPE',
    'READS_PLAN_FIELD',
    'MUTATES_TASK_FIELD',
  ]),
  from: z.string().min(1),
  to: z.string().min(1),
  projectId: z.string().min(1),
  confidence: z.number().min(0).max(1).default(1),
});

export const ParserContractGraphSchema = z.object({
  version: z.literal('parser-contract.v1'),
  projectId: z.string().min(1),
  parserName: z.string().min(1),
  generatedAt: z.string().datetime().optional(),
  nodes: z.array(ParserContractNodeSchema),
  edges: z.array(ParserContractEdgeSchema),
});

export type ParserStageType = z.infer<typeof ParserStageTypeSchema>;
export type ParserContractNode = z.infer<typeof ParserContractNodeSchema>;
export type ParserContractEdge = z.infer<typeof ParserContractEdgeSchema>;
export type ParserContractGraph = z.infer<typeof ParserContractGraphSchema>;
