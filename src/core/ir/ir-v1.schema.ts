import { z } from 'zod';

export const IrNodeTypeSchema = z.enum([
  'Artifact',
  'Container',
  'Symbol',
  'Site',
  'Entity',
  'Assertion',
]);

export const IrEdgeTypeSchema = z.enum([
  'CONTAINS',
  'DECLARES',
  'IMPORTS',
  'CALLS',
  'RESOLVES_TO',
  'REFERENCES',
  'MENTIONS',
  'QUOTES',
  'REGISTERED_BY',
]);

export const IrRangeSchema = z
  .object({
    startLine: z.number().int().min(1),
    startColumn: z.number().int().min(0).optional(),
    endLine: z.number().int().min(1).optional(),
    endColumn: z.number().int().min(0).optional(),
  })
  .strict();

export const IrNodeSchema = z
  .object({
    id: z.string().min(1),
    type: IrNodeTypeSchema,
    kind: z.string().min(1),
    name: z.string().min(1),
    projectId: z.string().min(1),
    sourcePath: z.string().min(1).optional(),
    language: z.string().min(1).optional(),
    sourceRevision: z.string().min(1).optional(),
    parserTier: z.number().int().min(0).max(2),
    confidence: z.number().min(0).max(1).default(1),
    provenanceKind: z.enum(['parser', 'enrichment', 'heuristic', 'manual']).default('parser'),
    range: IrRangeSchema.optional(),
    properties: z.record(z.string(), z.any()).default({}),
  })
  .strict();

export const IrEdgeSchema = z
  .object({
    id: z.string().min(1).optional(),
    type: IrEdgeTypeSchema,
    from: z.string().min(1),
    to: z.string().min(1),
    projectId: z.string().min(1),
    parserTier: z.number().int().min(0).max(2),
    confidence: z.number().min(0).max(1).default(1),
    provenanceKind: z.enum(['parser', 'enrichment', 'heuristic', 'manual']).default('parser'),
    properties: z.record(z.string(), z.any()).default({}),
  })
  .strict();

export const IrDocumentSchema = z
  .object({
    version: z.literal('ir.v1'),
    projectId: z.string().min(1),
    sourceKind: z.enum(['code', 'document', 'corpus', 'plan', 'runtime']),
    generatedAt: z.string().datetime().optional(),
    sourceRoot: z.string().min(1).optional(),
    nodes: z.array(IrNodeSchema),
    edges: z.array(IrEdgeSchema),
    metadata: z.record(z.string(), z.any()).default({}),
  })
  .strict()
  .superRefine((doc, ctx) => {
    const nodeIds = new Set(doc.nodes.map((n) => n.id));
    const allowExternalEdgeEndpoints = doc.metadata?.allowExternalEdgeEndpoints === true;
    const projectMismatches = doc.nodes.filter((n) => n.projectId !== doc.projectId);

    if (projectMismatches.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `All nodes must match document projectId (${doc.projectId})`,
      });
    }

    const edgeProjectMismatches = doc.edges.filter((e) => e.projectId !== doc.projectId);
    if (edgeProjectMismatches.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `All edges must match document projectId (${doc.projectId})`,
      });
    }

    if (!allowExternalEdgeEndpoints) {
      for (const edge of doc.edges) {
        if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Edge ${edge.type} references missing node(s): ${edge.from} -> ${edge.to}`,
          });
        }
      }
    }
  });

export type IrNodeType = z.infer<typeof IrNodeTypeSchema>;
export type IrEdgeType = z.infer<typeof IrEdgeTypeSchema>;
export type IrNode = z.infer<typeof IrNodeSchema>;
export type IrEdge = z.infer<typeof IrEdgeSchema>;
export type IrDocument = z.infer<typeof IrDocumentSchema>;
