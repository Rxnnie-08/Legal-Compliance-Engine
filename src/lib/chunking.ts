// Splits contract text into clause-sized chunks.
//
// Strategy (documented in docs/DOCUMENTATION.md):
//   1. If the text has numbered clauses ("1.", "2.1", "Article 3", "Section 4") -> one chunk per clause.
//   2. Otherwise split on blank lines (paragraphs).
//   3. Short fragments (headings like "TERMINATION") are merged into the next chunk.
//   4. Very long chunks are split on sentence boundaries so that each embedding stays focused.

export interface Chunk {
  position: number;
  heading: string | null;
  body: string;
}

const MIN_CHARS = 25;       // anything shorter is noise (page numbers, signature lines)
const MERGE_BELOW = 60;     // fragments shorter than this are glued to the next chunk
const MAX_CHARS = 1100;     // longer chunks get split
const TARGET_CHARS = 800;
const MAX_CHUNKS = 300;

const NUMBERED_START =
  /^\s*(?:(?:article|section|clause)\s+(?:\d+|[ivxlc]+)\b[.:)]?|\d{1,2}(?:\.\d{1,2}){0,2}[.)]?)\s+\S/i;

function normalise(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/\f/g, '\n\n')
    .replace(/[\t ]+/g, ' ')
    .replace(/-\n(?=[a-z])/g, '')          // re-join words hyphenated at a line break
    .replace(/[ ]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function toParagraph(block: string): string {
  return block.replace(/\s*\n\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();
}

function splitSentences(text: string): string[] {
  const parts = text.match(/[^.!?;]+(?:[.!?;]+(?=\s|$)|$)/g);
  return (parts ?? [text]).map((s) => s.trim()).filter(Boolean);
}

function splitLong(text: string): string[] {
  if (text.length <= MAX_CHARS) return [text];
  const out: string[] = [];
  let cur = '';
  for (const s of splitSentences(text)) {
    if (cur && (cur + ' ' + s).length > TARGET_CHARS) {
      out.push(cur);
      cur = s;
    } else {
      cur = cur ? cur + ' ' + s : s;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/** Heading = the short title after a clause number ("1. Confidentiality. ...") or an ALL-CAPS line. */
function detectHeading(block: string): string | null {
  const m = block.match(/^\s*(?:(?:article|section|clause)\s+(?:\d+|[ivxlc]+)\b[.:)]?|\d{1,2}(?:\.\d{1,2}){0,2}[.)]?)\s+([A-Z][A-Za-z0-9 ,&/'’()-]{2,70}?)[.:]\s/);
  if (m) return m[1].trim();
  const first = block.split(/\s+/).slice(0, 8).join(' ');
  if (block.length < MERGE_BELOW && first === first.toUpperCase() && /[A-Z]/.test(first)) return block.trim();
  return null;
}

export function splitIntoClauses(rawText: string): Chunk[] {
  const text = normalise(rawText);
  if (!text) return [];

  const lines = text.split('\n');
  const numberedStarts = lines.filter((l) => NUMBERED_START.test(l)).length;

  let blocks: string[] = [];
  if (numberedStarts >= 3) {
    // group lines: a numbered line starts a new clause
    let cur: string[] = [];
    for (const line of lines) {
      if (NUMBERED_START.test(line) && cur.length) {
        blocks.push(cur.join('\n'));
        cur = [];
      }
      cur.push(line);
    }
    if (cur.length) blocks.push(cur.join('\n'));
  } else {
    blocks = text.split(/\n{2,}/);
    if (blocks.length < 3) {
      // text with only single line breaks (typical for PDFs): group sentences instead
      const sentences = splitSentences(toParagraph(text));
      blocks = [];
      let cur = '';
      for (const s of sentences) {
        if (cur && (cur + ' ' + s).length > TARGET_CHARS) { blocks.push(cur); cur = s; }
        else cur = cur ? cur + ' ' + s : s;
      }
      if (cur) blocks.push(cur);
    }
  }

  const paragraphs = blocks.map(toParagraph).filter(Boolean);

  // merge tiny fragments (headings, "1." lines) into what follows
  const merged: string[] = [];
  let carry = '';
  for (const p of paragraphs) {
    const candidate = carry ? carry + ' ' + p : p;
    if (candidate.length < MERGE_BELOW) {
      carry = candidate;
    } else {
      merged.push(candidate);
      carry = '';
    }
  }
  if (carry) {
    if (merged.length) merged[merged.length - 1] += ' ' + carry;
    else merged.push(carry);
  }

  const chunks: Chunk[] = [];
  for (const m of merged) {
    const heading = detectHeading(m);
    const pieces = splitLong(m);
    pieces.forEach((piece, i) => {
      if (piece.length < MIN_CHARS) return;
      chunks.push({ position: 0, heading: i === 0 ? heading : heading ? `${heading} (cont.)` : null, body: piece });
    });
  }

  return chunks.slice(0, MAX_CHUNKS).map((c, i) => ({ ...c, position: i + 1 }));
}
