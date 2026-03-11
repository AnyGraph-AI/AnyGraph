import { IrDocument, IrDocumentSchema } from './ir-v1.schema.js';

export interface IrValidationResult {
  ok: boolean;
  data?: IrDocument;
  errors: string[];
}

export function validateIrDocument(input: unknown): IrValidationResult {
  const parsed = IrDocumentSchema.safeParse(input);

  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`),
    };
  }

  return {
    ok: true,
    data: parsed.data,
    errors: [],
  };
}

export function assertValidIrDocument(input: unknown): IrDocument {
  const result = validateIrDocument(input);
  if (!result.ok || !result.data) {
    throw new Error(`Invalid IR v1 document:\n${result.errors.join('\n')}`);
  }
  return result.data;
}
