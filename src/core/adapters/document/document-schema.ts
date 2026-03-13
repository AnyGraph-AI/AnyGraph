export type DocumentNodeKind = 'DocumentCollection' | 'DocumentNode' | 'Paragraph' | 'ExtractedEntity' | 'DocumentWitness';

export interface DocumentCollection {
  id: string;
  projectId: string;
  name: string;
  sourcePath: string;
  sourceType: 'directory' | 'single-file';
  createdAt: string;
}

export interface DocumentNode {
  id: string;
  projectId: string;
  collectionId: string;
  filePath: string;
  fileName: string;
  extension: string;
  contentHash?: string;
  pageCount?: number;
  paragraphCount: number;
  byteSize?: number;
  createdAt: string;
}

export interface Paragraph {
  id: string;
  projectId: string;
  documentId: string;
  ordinal: number;
  page?: number;
  text: string;
  charStart?: number;
  charEnd?: number;
}

export interface ExtractedEntity {
  id: string;
  projectId: string;
  documentId: string;
  paragraphId?: string;
  kind: 'person' | 'org' | 'date' | 'amount' | 'location' | 'email' | 'phone' | 'id' | 'other';
  value: string;
  normalized?: string;
  confidence: number;
  extractor: 'regex' | 'dictionary' | 'llm';
}

export interface DocumentWitness {
  id: string;
  projectId: string;
  witnessId: string;
  sourceType: 'pdf' | 'text';
  sourcePath: string;
  contentHash: string;
  extractionTimestamp: string;
  documentId: string;
}

export interface DocumentAdapterSchema {
  collection: DocumentCollection;
  documents: DocumentNode[];
  paragraphs: Paragraph[];
  entities: ExtractedEntity[];
  witnesses: DocumentWitness[];
}
