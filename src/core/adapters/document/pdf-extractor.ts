import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { basename, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface ExtractedPdfPage {
  page: number;
  text: string;
}

export interface ExtractedPdfDocument {
  filePath: string;
  fileName: string;
  pageCount: number;
  pages: ExtractedPdfPage[];
}

/**
 * Extract PDF text using Python + PyMuPDF (fitz).
 * This keeps the adapter dependency-light in Node while using the proven Dataset-10 path.
 */
export async function extractPdfText(filePath: string): Promise<ExtractedPdfDocument> {
  const absolutePath = resolve(filePath);
  await access(absolutePath, constants.R_OK);

  const pyScript = `
import json, sys
try:
    import fitz
except Exception as e:
    print(json.dumps({"ok": False, "error": f"PyMuPDF import failed: {e}"}))
    sys.exit(2)

path = sys.argv[1]
try:
    doc = fitz.open(path)
    out = {
        "ok": True,
        "pageCount": len(doc),
        "pages": []
    }
    for idx, page in enumerate(doc, start=1):
        out["pages"].append({
            "page": idx,
            "text": page.get_text() or ""
        })
    print(json.dumps(out))
except Exception as e:
    print(json.dumps({"ok": False, "error": str(e)}))
    sys.exit(3)
`;

  const { stdout, stderr } = await execFileAsync('python3', ['-c', pyScript, absolutePath], {
    maxBuffer: 20 * 1024 * 1024,
  });

  if (stderr?.trim()) {
    // Python warnings are non-fatal; only parse failure should hard-fail.
  }

  let parsed: {
    ok: boolean;
    error?: string;
    pageCount?: number;
    pages?: Array<{ page: number; text: string }>;
  };

  try {
    parsed = JSON.parse(stdout.trim());
  } catch (error) {
    throw new Error(`Failed to parse PDF extractor output for ${absolutePath}: ${String(error)}`);
  }

  if (!parsed.ok) {
    throw new Error(`PDF extraction failed for ${absolutePath}: ${parsed.error ?? 'unknown error'}`);
  }

  return {
    filePath: absolutePath,
    fileName: basename(absolutePath),
    pageCount: Number(parsed.pageCount ?? 0),
    pages: (parsed.pages ?? []).map((p) => ({ page: Number(p.page), text: String(p.text ?? '') })),
  };
}
