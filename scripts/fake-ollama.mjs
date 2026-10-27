// A tiny stand-in for Ollama, ONLY for developing/testing without a GPU or model download.
// It implements the two endpoints the app uses (/api/embed and /api/chat).
// Embeddings are hashed bag-of-words vectors: texts that share vocabulary get a high cosine
// similarity, which is enough to exercise the whole pipeline, but it is NOT semantic.
//   node scripts/fake-ollama.mjs            (listens on :11434, or set PORT)
import http from 'node:http';

const DIM = 384;
const STOP = new Set('a an and are as at be by for from has have in is it its of on or shall that the their this to was will with any all each other such than then these those which who'.split(' '));

function fnv(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
const stem = (w) => w.replace(/(ing|ed|es|s|ly)$/, '');

function embed(text) {
  const words = text.toLowerCase().replace(/^search_(document|query):\s*/, '').split(/[^a-z0-9]+/).filter((w) => w && !STOP.has(w)).map(stem);
  const v = new Float64Array(DIM);
  const add = (tok, weight) => { const h = fnv(tok); v[h % DIM] += (h & 0x80000000 ? -1 : 1) * weight; };
  words.forEach((w, i) => { add(w, 1); if (i) add(words[i - 1] + '_' + w, 0.7); });
  const norm = Math.hypot(...v) || 1;
  return Array.from(v, (x) => x / norm);
}

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (d) => (body += d));
  req.on('end', () => {
    const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    try {
      if (req.url === '/api/embed') {
        const { input } = JSON.parse(body);
        return send(200, { embeddings: (Array.isArray(input) ? input : [input]).map(embed) });
      }
      if (req.url === '/api/chat') {
        const { messages } = JSON.parse(body);
        const user = messages.filter((m) => m.role === 'user').pop()?.content ?? '';
        const finding = (user.match(/Finding: ([^\n]*)/) || [])[1] ?? '';
        return send(200, { message: { role: 'assistant', content: `[stand-in model] ${finding} Please compare the clause with the standard wording and negotiate a fix.` } });
      }
      if (req.url === '/api/tags') return send(200, { models: [] });
      send(404, { error: 'not found' });
    } catch (e) { send(400, { error: String(e) }); }
  });
});
const port = Number(process.env.PORT || 11434);
server.listen(port, () => console.log(`stand-in Ollama listening on :${port}`));
