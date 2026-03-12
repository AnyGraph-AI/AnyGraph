import { readFile } from 'node:fs/promises';
import { basename, extname, resolve } from 'node:path';
import { splitParagraphs } from './utils.js';

export interface ExtractedTextDocument {
  filePath: string;
  fileName: string;
  extension: string;
  paragraphs: string[];
}

/**
 * Ingest plaintext-like files (txt, md, csv, json, log) into paragraph blocks.
 */
export async function ingestPlainText(filePath: string): Promise<ExtractedTextDocument> {
  const absolutePath = resolve(filePath);
  const extension = extname(absolutePath).toLowerCase();
  const content = await readFile(absolutePath, 'utf8');

  const paragraphs = splitParagraphs(content);

  return {
    filePath: absolutePath,
    fileName: basename(absolutePath),
    extension,
    paragraphs,
  };
}
