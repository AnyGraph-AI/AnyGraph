import { deterministicId } from './utils.js';
import type { ExtractedEntity } from './document-schema.js';

export interface EntityExtractionInput {
  projectId: string;
  documentId: string;
  paragraphId: string;
  text: string;
}

const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE_RE = /\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/g;
const DATE_RE = /\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{2,4})\b/gi;
const AMOUNT_RE = /\b(?:USD\s*)?\$\s?\d{1,3}(?:,\d{3})*(?:\.\d{2})?\b/g;

const ORG_HINTS = ['Inc', 'LLC', 'Ltd', 'Corp', 'Bank', 'Foundation', 'Trust', 'Company'];
const PERSON_DICTIONARY = new Set<string>(['Jeffrey Epstein', 'Ghislaine Maxwell', 'Lesley Groff', 'Jonathan']);

function normalizeValue(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function makeEntity(
  input: EntityExtractionInput,
  kind: ExtractedEntity['kind'],
  value: string,
  extractor: ExtractedEntity['extractor'],
  confidence: number,
): ExtractedEntity {
  const normalized = normalizeValue(value);
  return {
    id: deterministicId(input.projectId, input.documentId, input.paragraphId, kind, normalized),
    projectId: input.projectId,
    documentId: input.documentId,
    paragraphId: input.paragraphId,
    kind,
    value: normalized,
    normalized: normalized.toLowerCase(),
    confidence,
    extractor,
  };
}

export function extractEntities(input: EntityExtractionInput): ExtractedEntity[] {
  const out: ExtractedEntity[] = [];
  const seen = new Set<string>();

  const pushUnique = (entity: ExtractedEntity): void => {
    const key = `${entity.kind}|${entity.normalized}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(entity);
  };

  for (const match of input.text.match(EMAIL_RE) ?? []) {
    pushUnique(makeEntity(input, 'email', match, 'regex', 0.98));
  }

  for (const match of input.text.match(PHONE_RE) ?? []) {
    pushUnique(makeEntity(input, 'phone', match, 'regex', 0.95));
  }

  for (const match of input.text.match(DATE_RE) ?? []) {
    pushUnique(makeEntity(input, 'date', match, 'regex', 0.9));
  }

  for (const match of input.text.match(AMOUNT_RE) ?? []) {
    pushUnique(makeEntity(input, 'amount', match, 'regex', 0.92));
  }

  for (const person of PERSON_DICTIONARY) {
    if (input.text.toLowerCase().includes(person.toLowerCase())) {
      pushUnique(makeEntity(input, 'person', person, 'dictionary', 0.85));
    }
  }

  // lightweight org extraction: Title Case phrases ending in org hints
  const orgPattern = new RegExp(`\\b([A-Z][\\w&.-]*(?:\\s+[A-Z][\\w&.-]*)*\\s+(?:${ORG_HINTS.join('|')}))\\b`, 'g');
  for (const match of input.text.match(orgPattern) ?? []) {
    pushUnique(makeEntity(input, 'org', match, 'regex', 0.72));
  }

  return out;
}
