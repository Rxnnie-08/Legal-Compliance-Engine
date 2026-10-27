// Central place for configuration.  Everything comes from environment variables
// (see .env.example) - nothing sensitive is hard-coded in the source.
// Getters are lazy so that `next build` works without a configured environment.
function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name}. Copy .env.example to .env.local and fill it in.`);
  return v;
}

export const env = {
  get databaseUrl() { return required('DATABASE_URL'); },
  get qdrantUrl() { return process.env.QDRANT_URL || 'http://localhost:6333'; },
  get qdrantApiKey() { return process.env.QDRANT_API_KEY || undefined; },
  get ollamaUrl() { return (process.env.OLLAMA_URL || 'http://localhost:11434').replace(/\/$/, ''); },
  get llmModel() { return process.env.OLLAMA_LLM_MODEL || 'llama3.2'; },
  get embedModel() { return process.env.OLLAMA_EMBED_MODEL || 'nomic-embed-text'; },
  get jwtSecret() {
    const s = required('JWT_SECRET');
    if (s.length < 32) throw new Error('JWT_SECRET must be at least 32 characters long.');
    return s;
  },
  get isProd() { return process.env.NODE_ENV === 'production'; },
};
