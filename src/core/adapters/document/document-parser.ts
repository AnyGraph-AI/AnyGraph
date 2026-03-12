import { readdir, stat } from 'node:fs/promises';
import { basename, extname, resolve } from 'node:path';
import { createHash } from 'node:crypto';

import type {
  DocumentAdapterSchema,
  DocumentCollection,
  DocumentNode,
  ExtractedEntity,
  Paragraph,
} from './document-schema.js';
import { deterministicId } from './utils.js';
import { extractPdfText } from './pdf-extractor.js';
import { ingestPlainText } from './text-ingester.js';
import { extractEntities } from './entity-extractor.js';
import type { IrDocument } from '../../ir/ir-v1.schema.js';

const TEXT_EXTS = new Set(['.txt', '.md', '.csv', '.json', '.log']);

export interface ParseDocumentCollectionOptions {
  projectId: string;
  sourcePath: string;
  collectionName?: string;
}

async function collectFiles(path: string): Promise<string[]> {
  const abs = resolve(path);
  const s = await stat(abs);
  if (s.isFile()) return [abs];

  const out: string[] = [];
  const entries = await readdir(abs, { withFileTypes: true });
  for (const entry of entries) {
    const child = resolve(abs, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await collectFiles(child)));
    } else if (entry.isFile()) {
      out.push(child);
    } else if (entry.isSymbolicLink()) {
      // Follow symlinked files/directories (common in staging datasets)
      const childStat = await stat(child);
      if (childStat.isDirectory()) {
        out.push(...(await collectFiles(child)));
      } else if (childStat.isFile()) {
        out.push(child);
      }
    }
  }
  return out;
}

export async function parseDocumentCollection(
  options: ParseDocumentCollectionOptions,
): Promise<DocumentAdapterSchema> {
  const sourcePath = resolve(options.sourcePath);
  const files = await collectFiles(sourcePath);

  const collectionId = deterministicId(options.projectId, 'DocumentCollection', sourcePath);
  const collection: DocumentCollection = {
    id: collectionId,
    projectId: options.projectId,
    name: options.collectionName ?? basename(sourcePath),
    sourcePath,
    sourceType: (await stat(sourcePath)).isDirectory() ? 'directory' : 'single-file',
    createdAt: new Date().toISOString(),
  };

  const documents: DocumentNode[] = [];
  const paragraphs: Paragraph[] = [];
  const entities: ExtractedEntity[] = [];

  for (const filePath of files) {
    const extension = extname(filePath).toLowerCase();
    const fileName = basename(filePath);
    const documentId = deterministicId(options.projectId, 'DocumentNode', filePath);

    let paraTexts: Array<{ text: string; page?: number }> = [];
    let pageCount = 0;

    if (extension === '.pdf') {
      const pdf = await extractPdfText(filePath);
      pageCount = pdf.pageCount;
      paraTexts = pdf.pages.flatMap((p) =>
        p.text
          .split(/\n\s*\n/g)
          .map((t) => t.replace(/\s+/g, ' ').trim())
          .filter(Boolean)
          .map((text) => ({ text, page: p.page })),
      );
    } else if (TEXT_EXTS.has(extension)) {
      const txt = await ingestPlainText(filePath);
      paraTexts = txt.paragraphs.map((text) => ({ text }));
    } else {
      continue;
    }

    const contentHash = createHash('sha256').update(paraTexts.map((p) => p.text).join('\n')).digest('hex');

    documents.push({
      id: documentId,
      projectId: options.projectId,
      collectionId,
      filePath,
      fileName,
      extension,
      contentHash,
      pageCount: pageCount || undefined,
      paragraphCount: paraTexts.length,
      createdAt: new Date().toISOString(),
    });

    paraTexts.forEach((p, idx) => {
      const ordinal = idx + 1;
      const paragraphId = deterministicId(options.projectId, documentId, 'Paragraph', ordinal);
      const paragraph: Paragraph = {
        id: paragraphId,
        projectId: options.projectId,
        documentId,
        ordinal,
        page: p.page,
        text: p.text,
      };

      paragraphs.push(paragraph);
      entities.push(
        ...extractEntities({
          projectId: options.projectId,
          documentId,
          paragraphId,
          text: p.text,
        }),
      );
    });
  }

  return {
    collection,
    documents,
    paragraphs,
    entities,
  };
}

export function documentSchemaToIr(schema: DocumentAdapterSchema): IrDocument {
  const nodes: IrDocument['nodes'] = [];
  const edges: IrDocument['edges'] = [];

  nodes.push({
    id: schema.collection.id,
    type: 'Artifact',
    kind: 'DocumentCollection',
    name: schema.collection.name,
    projectId: schema.collection.projectId,
    sourcePath: schema.collection.sourcePath,
    parserTier: 1,
    confidence: 1,
    provenanceKind: 'parser',
    properties: {
      sourceType: schema.collection.sourceType,
      createdAt: schema.collection.createdAt,
    },
  });

  for (const doc of schema.documents) {
    nodes.push({
      id: doc.id,
      type: 'Artifact',
      kind: 'DocumentNode',
      name: doc.fileName,
      projectId: doc.projectId,
      sourcePath: doc.filePath,
      parserTier: 1,
      confidence: 1,
      provenanceKind: 'parser',
      properties: {
        extension: doc.extension,
        pageCount: doc.pageCount,
        paragraphCount: doc.paragraphCount,
        contentHash: doc.contentHash,
      },
    });

    edges.push({
      type: 'CONTAINS',
      from: schema.collection.id,
      to: doc.id,
      projectId: doc.projectId,
      parserTier: 1,
      confidence: 1,
      provenanceKind: 'parser',
      properties: { relation: 'collection_document' },
    });
  }

  for (const para of schema.paragraphs) {
    nodes.push({
      id: para.id,
      type: 'Site',
      kind: 'Paragraph',
      name: `paragraph_${para.ordinal}`,
      projectId: para.projectId,
      sourcePath: undefined,
      parserTier: 1,
      confidence: 1,
      provenanceKind: 'parser',
      properties: {
        documentId: para.documentId,
        ordinal: para.ordinal,
        page: para.page,
        text: para.text,
      },
    });

    edges.push({
      type: 'CONTAINS',
      from: para.documentId,
      to: para.id,
      projectId: para.projectId,
      parserTier: 1,
      confidence: 1,
      provenanceKind: 'parser',
      properties: { relation: 'document_paragraph' },
    });
  }

  for (const ent of schema.entities) {
    nodes.push({
      id: ent.id,
      type: 'Entity',
      kind: ent.kind,
      name: ent.value,
      projectId: ent.projectId,
      parserTier: 1,
      confidence: ent.confidence,
      provenanceKind: ent.extractor === 'llm' ? 'enrichment' : 'heuristic',
      properties: {
        documentId: ent.documentId,
        paragraphId: ent.paragraphId,
        normalized: ent.normalized,
        extractor: ent.extractor,
      },
    });

    if (ent.paragraphId) {
      edges.push({
        type: 'MENTIONS',
        from: ent.paragraphId,
        to: ent.id,
        projectId: ent.projectId,
        parserTier: 1,
        confidence: ent.confidence,
        provenanceKind: 'heuristic',
        properties: { relation: 'paragraph_mentions_entity' },
      });
    }
  }

  return {
    version: 'ir.v1',
    projectId: schema.collection.projectId,
    sourceKind: 'document',
    generatedAt: new Date().toISOString(),
    sourceRoot: schema.collection.sourcePath,
    nodes,
    edges,
    metadata: {
      documentCount: schema.documents.length,
      paragraphCount: schema.paragraphs.length,
      entityCount: schema.entities.length,
    },
  };
}
