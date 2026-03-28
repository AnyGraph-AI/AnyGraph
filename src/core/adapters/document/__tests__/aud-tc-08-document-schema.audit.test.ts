/**
 * AUD-TC-08-L1-02: document-schema.ts — Type Definition Contract Tests
 *
 * Spec: plans/codegraph/ADAPTER_ROADMAP.md §Milestone 2 "Define Document adapter schema" — type definitions for document adapter
 *
 * Behaviors tested:
 * (1) DocumentNodeKind is union of exactly 5 types: DocumentCollection/DocumentNode/Paragraph/ExtractedEntity/DocumentWitness
 * (2) DocumentCollection interface has required fields: id, projectId, name, sourcePath, sourceType ('directory'|'single-file'), createdAt
 * (3) DocumentNode interface has required fields: id, projectId, collectionId, filePath, fileName, extension, paragraphCount, createdAt + optional: contentHash, pageCount, byteSize
 * (4) Paragraph interface has required fields: id, projectId, documentId, ordinal, text + optional: page, charStart, charEnd
 * (5) ExtractedEntity has kind union: person/org/date/amount/location/email/phone/id/other, confidence (number), extractor ('regex'|'dictionary'|'llm')
 * (6) DocumentWitness has witnessId, sourceType ('pdf'|'text'), contentHash, extractionTimestamp, documentId
 * (7) DocumentAdapterSchema aggregates all: collection + documents[] + paragraphs[] + entities[] + witnesses[]
 */
import { describe, it, expect } from 'vitest';
import type {
  DocumentNodeKind,
  DocumentCollection,
  DocumentNode,
  Paragraph,
  ExtractedEntity,
  DocumentWitness,
  DocumentAdapterSchema,
} from '../document-schema.js';

describe('[aud-tc-08] document-schema.ts', () => {
  // Behavior 1: DocumentNodeKind is union of exactly 5 types
  it('B1: DocumentNodeKind union accepts all 5 types', () => {
    const kinds: DocumentNodeKind[] = [
      'DocumentCollection',
      'DocumentNode',
      'Paragraph',
      'ExtractedEntity',
      'DocumentWitness',
    ];

    expect(kinds).toHaveLength(5);
    kinds.forEach((k) => {
      const kind: DocumentNodeKind = k;
      expect(['DocumentCollection', 'DocumentNode', 'Paragraph', 'ExtractedEntity', 'DocumentWitness']).toContain(kind);
    });
  });

  // Behavior 2: DocumentCollection has required fields with correct types
  it('B2: DocumentCollection has required fields', () => {
    const collection: DocumentCollection = {
      id: 'col_123',
      projectId: 'proj_test',
      name: 'Test Collection',
      sourcePath: '/path/to/docs',
      sourceType: 'directory',
      createdAt: new Date().toISOString(),
    };

    expect(collection.id).toBe('col_123');
    expect(collection.projectId).toBe('proj_test');
    expect(collection.name).toBe('Test Collection');
    expect(collection.sourcePath).toBe('/path/to/docs');
    expect(collection.sourceType).toBe('directory');
    expect(collection.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  // Behavior 2 (continued): sourceType is strictly 'directory' | 'single-file'
  it('B2b: DocumentCollection sourceType is typed as directory or single-file', () => {
    const dir: DocumentCollection = {
      id: 'col_1',
      projectId: 'proj_1',
      name: 'Dir',
      sourcePath: '/path',
      sourceType: 'directory',
      createdAt: '2024-01-01T00:00:00Z',
    };

    const file: DocumentCollection = {
      id: 'col_2',
      projectId: 'proj_1',
      name: 'File',
      sourcePath: '/path/doc.pdf',
      sourceType: 'single-file',
      createdAt: '2024-01-01T00:00:00Z',
    };

    expect(dir.sourceType).toBe('directory');
    expect(file.sourceType).toBe('single-file');
  });

  // Behavior 3: DocumentNode has required + optional fields
  it('B3: DocumentNode has required fields', () => {
    const doc: DocumentNode = {
      id: 'doc_456',
      projectId: 'proj_test',
      collectionId: 'col_123',
      filePath: '/path/to/file.txt',
      fileName: 'file.txt',
      extension: '.txt',
      paragraphCount: 5,
      createdAt: new Date().toISOString(),
    };

    expect(doc.id).toBe('doc_456');
    expect(doc.projectId).toBe('proj_test');
    expect(doc.collectionId).toBe('col_123');
    expect(doc.filePath).toBe('/path/to/file.txt');
    expect(doc.fileName).toBe('file.txt');
    expect(doc.extension).toBe('.txt');
    expect(doc.paragraphCount).toBe(5);
    expect(doc.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  // Behavior 3 (continued): optional fields are type-safe
  it('B3b: DocumentNode accepts optional fields', () => {
    const doc: DocumentNode = {
      id: 'doc_789',
      projectId: 'proj_test',
      collectionId: 'col_123',
      filePath: '/path/to/file.pdf',
      fileName: 'file.pdf',
      extension: '.pdf',
      contentHash: 'abc123',
      pageCount: 10,
      byteSize: 1024,
      paragraphCount: 20,
      createdAt: '2024-01-01T00:00:00Z',
    };

    expect(doc.contentHash).toBe('abc123');
    expect(doc.pageCount).toBe(10);
    expect(doc.byteSize).toBe(1024);
  });

  // Behavior 4: Paragraph has required + optional fields
  it('B4: Paragraph has required fields', () => {
    const para: Paragraph = {
      id: 'para_101',
      projectId: 'proj_test',
      documentId: 'doc_456',
      ordinal: 1,
      text: 'This is a paragraph.',
    };

    expect(para.id).toBe('para_101');
    expect(para.projectId).toBe('proj_test');
    expect(para.documentId).toBe('doc_456');
    expect(para.ordinal).toBe(1);
    expect(para.text).toBe('This is a paragraph.');
  });

  // Behavior 4 (continued): optional fields for paragraphs
  it('B4b: Paragraph accepts optional page and char position fields', () => {
    const para: Paragraph = {
      id: 'para_102',
      projectId: 'proj_test',
      documentId: 'doc_456',
      ordinal: 2,
      page: 5,
      text: 'Paragraph on page 5.',
      charStart: 100,
      charEnd: 200,
    };

    expect(para.page).toBe(5);
    expect(para.charStart).toBe(100);
    expect(para.charEnd).toBe(200);
  });

  // Behavior 5: ExtractedEntity has kind union and required fields
  it('B5: ExtractedEntity kind is union of 9 types', () => {
    const kinds: Array<ExtractedEntity['kind']> = [
      'person',
      'org',
      'date',
      'amount',
      'location',
      'email',
      'phone',
      'id',
      'other',
    ];

    expect(kinds).toHaveLength(9);

    const entity: ExtractedEntity = {
      id: 'ent_1',
      projectId: 'proj_test',
      documentId: 'doc_456',
      paragraphId: 'para_101',
      kind: 'person',
      value: 'John Doe',
      confidence: 0.95,
      extractor: 'regex',
    };

    expect(entity.kind).toBe('person');
    expect(entity.confidence).toBe(0.95);
    expect(entity.extractor).toBe('regex');
  });

  // Behavior 5 (continued): extractor is typed as 'regex' | 'dictionary' | 'llm'
  it('B5b: ExtractedEntity extractor is typed strictly', () => {
    const regex: ExtractedEntity = {
      id: 'ent_1',
      projectId: 'proj_1',
      documentId: 'doc_1',
      kind: 'email',
      value: 'test@example.com',
      confidence: 0.98,
      extractor: 'regex',
    };

    const dictionary: ExtractedEntity = {
      id: 'ent_2',
      projectId: 'proj_1',
      documentId: 'doc_1',
      kind: 'person',
      value: 'Jeffrey Epstein',
      confidence: 0.85,
      extractor: 'dictionary',
    };

    const llm: ExtractedEntity = {
      id: 'ent_3',
      projectId: 'proj_1',
      documentId: 'doc_1',
      kind: 'org',
      value: 'Acme Corp',
      confidence: 0.75,
      extractor: 'llm',
    };

    expect(regex.extractor).toBe('regex');
    expect(dictionary.extractor).toBe('dictionary');
    expect(llm.extractor).toBe('llm');
  });

  // Behavior 5 (continued): normalized field is optional
  it('B5c: ExtractedEntity accepts optional normalized field', () => {
    const entity: ExtractedEntity = {
      id: 'ent_4',
      projectId: 'proj_1',
      documentId: 'doc_1',
      kind: 'person',
      value: 'John Doe',
      normalized: 'john doe',
      confidence: 0.9,
      extractor: 'regex',
    };

    expect(entity.normalized).toBe('john doe');
  });

  // Behavior 6: DocumentWitness has required fields with correct types
  it('B6: DocumentWitness has required fields', () => {
    const witness: DocumentWitness = {
      id: 'wit_1',
      projectId: 'proj_test',
      witnessId: 'abc123def456',
      sourceType: 'pdf',
      sourcePath: '/path/to/doc.pdf',
      contentHash: 'hash123',
      extractionTimestamp: new Date().toISOString(),
      documentId: 'doc_456',
    };

    expect(witness.id).toBe('wit_1');
    expect(witness.projectId).toBe('proj_test');
    expect(witness.witnessId).toBe('abc123def456');
    expect(witness.sourceType).toBe('pdf');
    expect(witness.sourcePath).toBe('/path/to/doc.pdf');
    expect(witness.contentHash).toBe('hash123');
    expect(witness.extractionTimestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(witness.documentId).toBe('doc_456');
  });

  // Behavior 6 (continued): sourceType is strictly 'pdf' | 'text'
  it('B6b: DocumentWitness sourceType is typed as pdf or text', () => {
    const pdfWitness: DocumentWitness = {
      id: 'wit_1',
      projectId: 'proj_1',
      witnessId: 'w1',
      sourceType: 'pdf',
      sourcePath: '/doc.pdf',
      contentHash: 'hash1',
      extractionTimestamp: '2024-01-01T00:00:00Z',
      documentId: 'doc_1',
    };

    const textWitness: DocumentWitness = {
      id: 'wit_2',
      projectId: 'proj_1',
      witnessId: 'w2',
      sourceType: 'text',
      sourcePath: '/doc.txt',
      contentHash: 'hash2',
      extractionTimestamp: '2024-01-01T00:00:00Z',
      documentId: 'doc_2',
    };

    expect(pdfWitness.sourceType).toBe('pdf');
    expect(textWitness.sourceType).toBe('text');
  });

  // Behavior 7: DocumentAdapterSchema aggregates all types
  it('B7: DocumentAdapterSchema has all required aggregate fields', () => {
    const schema: DocumentAdapterSchema = {
      collection: {
        id: 'col_1',
        projectId: 'proj_1',
        name: 'Test',
        sourcePath: '/test',
        sourceType: 'directory',
        createdAt: '2024-01-01T00:00:00Z',
      },
      documents: [],
      paragraphs: [],
      entities: [],
      witnesses: [],
    };

    expect(schema.collection).toBeDefined();
    expect(Array.isArray(schema.documents)).toBe(true);
    expect(Array.isArray(schema.paragraphs)).toBe(true);
    expect(Array.isArray(schema.entities)).toBe(true);
    expect(Array.isArray(schema.witnesses)).toBe(true);
  });

  // Behavior 7 (continued): schema accepts populated arrays
  it('B7b: DocumentAdapterSchema accepts populated arrays', () => {
    const schema: DocumentAdapterSchema = {
      collection: {
        id: 'col_1',
        projectId: 'proj_1',
        name: 'Test',
        sourcePath: '/test',
        sourceType: 'directory',
        createdAt: '2024-01-01T00:00:00Z',
      },
      documents: [
        {
          id: 'doc_1',
          projectId: 'proj_1',
          collectionId: 'col_1',
          filePath: '/test/doc.txt',
          fileName: 'doc.txt',
          extension: '.txt',
          paragraphCount: 1,
          createdAt: '2024-01-01T00:00:00Z',
        },
      ],
      paragraphs: [
        {
          id: 'para_1',
          projectId: 'proj_1',
          documentId: 'doc_1',
          ordinal: 1,
          text: 'Test paragraph.',
        },
      ],
      entities: [
        {
          id: 'ent_1',
          projectId: 'proj_1',
          documentId: 'doc_1',
          paragraphId: 'para_1',
          kind: 'email',
          value: 'test@example.com',
          confidence: 0.98,
          extractor: 'regex',
        },
      ],
      witnesses: [
        {
          id: 'wit_1',
          projectId: 'proj_1',
          witnessId: 'w1',
          sourceType: 'text',
          sourcePath: '/test/doc.txt',
          contentHash: 'hash1',
          extractionTimestamp: '2024-01-01T00:00:00Z',
          documentId: 'doc_1',
        },
      ],
    };

    expect(schema.documents).toHaveLength(1);
    expect(schema.paragraphs).toHaveLength(1);
    expect(schema.entities).toHaveLength(1);
    expect(schema.witnesses).toHaveLength(1);
  });
});
