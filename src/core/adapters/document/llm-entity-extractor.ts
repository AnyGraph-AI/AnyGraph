import OpenAI from 'openai';
import { z } from 'zod';
import type { ExtractedEntity } from './document-schema.js';
import type { EntityExtractionInput } from './entity-extractor.js';
import { deterministicId } from './utils.js';

const LlmEntitySchema = z.object({
  kind: z.enum(['person', 'org', 'date', 'amount', 'location', 'email', 'phone', 'id', 'other']),
  value: z.string().min(1),
  confidence: z.number().min(0).max(1).optional(),
});

const LlmEntityResponseSchema = z.object({
  entities: z.array(LlmEntitySchema).default([]),
});

export interface LlmEntityExtractorOptions {
  enabled?: boolean;
  maxEntities?: number;
  model?: string;
}

function shouldRunLlm(heuristicEntities: ExtractedEntity[]): boolean {
  // Targeted only: run when heuristics are sparse or uncertain.
  if (heuristicEntities.length <= 1) return true;
  const lowConfidenceCount = heuristicEntities.filter((e) => e.confidence < 0.8).length;
  return lowConfidenceCount > 0;
}

export async function extractEntitiesWithLlm(
  input: EntityExtractionInput,
  heuristicEntities: ExtractedEntity[],
  options: LlmEntityExtractorOptions = {},
): Promise<ExtractedEntity[]> {
  const enabled = options.enabled ?? process.env.DOCUMENT_LLM_ENTITY_EXTRACTION === 'true';
  if (!enabled) return [];
  if (!process.env.OPENAI_API_KEY) return [];
  if (!shouldRunLlm(heuristicEntities)) return [];

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const maxEntities = options.maxEntities ?? 12;
  const model = options.model ?? process.env.DOCUMENT_LLM_ENTITY_MODEL ?? 'gpt-4o-mini';

  const prompt = [
    'Extract ONLY concrete entities from this paragraph.',
    'Return strict JSON: {"entities":[{"kind":"person|org|date|amount|location|email|phone|id|other","value":"...","confidence":0..1}]}',
    `Limit to ${maxEntities} entities.`,
    'Do not include explanations.',
    '',
    'Paragraph:',
    input.text,
  ].join('\n');

  const response = await openai.responses.create({
    model,
    input: prompt,
    temperature: 0,
  });

  const raw = response.output_text?.trim();
  if (!raw) return [];

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    return [];
  }

  const parsed = LlmEntityResponseSchema.safeParse(parsedJson);
  if (!parsed.success) return [];

  const out: ExtractedEntity[] = [];
  const seen = new Set<string>(heuristicEntities.map((e) => `${e.kind}|${(e.normalized ?? e.value).toLowerCase()}`));

  for (const ent of parsed.data.entities.slice(0, maxEntities)) {
    const normalized = ent.value.trim().toLowerCase();
    const key = `${ent.kind}|${normalized}`;
    if (!normalized || seen.has(key)) continue;
    seen.add(key);

    out.push({
      id: deterministicId(input.projectId, input.documentId, input.paragraphId, 'llm', ent.kind, ent.value),
      projectId: input.projectId,
      documentId: input.documentId,
      paragraphId: input.paragraphId,
      kind: ent.kind,
      value: ent.value.trim(),
      normalized,
      confidence: Math.max(0, Math.min(1, Number(ent.confidence ?? 0.75))),
      extractor: 'llm',
    });
  }

  return out;
}
