import { extractText, getDocumentProxy } from 'unpdf';

export class UnsupportedFileError extends Error {}

/** Extract the text layer of a PDF.  Scanned PDFs (images only) have no text layer. */
export async function extractPdfText(data: Uint8Array): Promise<string> {
  const pdf = await getDocumentProxy(data);
  const { text } = await extractText(pdf, { mergePages: true });
  const joined = Array.isArray(text) ? text.join('\n\n') : text;
  if (joined.replace(/\s+/g, '').length < 40) {
    throw new UnsupportedFileError(
      'This PDF has no extractable text (it is probably a scan). Upload a text-based PDF or a .txt file; OCR is not supported.',
    );
  }
  return joined;
}

/** Return plain text for an uploaded file, based on its type. */
export async function extractText_(filename: string, mime: string, data: Uint8Array): Promise<string> {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.pdf') || mime === 'application/pdf') return extractPdfText(data);
  if (lower.endsWith('.txt') || mime.startsWith('text/')) return new TextDecoder('utf-8').decode(data);
  throw new UnsupportedFileError('Only PDF and plain-text (.txt) files are supported.');
}
