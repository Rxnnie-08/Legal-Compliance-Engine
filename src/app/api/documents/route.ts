import { requireUser } from '@/lib/auth';
import { ingestDocument } from '@/lib/documents';
import { HttpError, handle, ok } from '@/lib/http';
import { extractText_, UnsupportedFileError } from '@/lib/pdf';
import { idParam } from '@/lib/validation';

export const runtime = 'nodejs';
export const maxDuration = 300; // embedding a long contract with a local model can take a while
const MAX_BYTES = 8 * 1024 * 1024;

export const POST = handle(async (req) => {
  const user = await requireUser(['admin', 'reviewer']);
  const form = await req.formData().catch(() => { throw new HttpError(400, 'Expected a multipart form upload.'); });

  const file = form.get('file');
  if (!(file instanceof File)) throw new HttpError(400, 'Choose a PDF or .txt file to upload.');
  if (file.size === 0) throw new HttpError(400, 'The file is empty.');
  if (file.size > MAX_BYTES) throw new HttpError(413, 'The file is larger than 8 MB.');
  const caseId = idParam.parse(form.get('caseId'));
  const title = String(form.get('title') ?? '').trim() || file.name.replace(/\.[^.]+$/, '');
  if (title.length > 200) throw new HttpError(400, 'The title is longer than 200 characters.');

  const bytes = new Uint8Array(await file.arrayBuffer());
  let text: string;
  try {
    text = await extractText_(file.name, file.type || '', bytes);
  } catch (e) {
    if (e instanceof UnsupportedFileError) throw new HttpError(415, e.message);
    throw new HttpError(422, 'This file could not be read. Is it a valid PDF?');
  }

  const result = await ingestDocument(user, { caseId, title, filename: file.name, mime: file.type || 'application/octet-stream', size: file.size, text });
  return ok(result, 201);
});
