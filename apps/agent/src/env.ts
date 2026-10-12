export const env = {
  PORT: Number(process.env.PORT ?? 8787),
  DATABASE_URL: process.env.DATABASE_URL ?? "postgres://erp:erp@localhost:5432/erp",
  OLLAMA_URL: process.env.OLLAMA_URL ?? "http://localhost:11434",
  OLLAMA_MODEL: process.env.OLLAMA_MODEL ?? "gemma4:12b",
  SHARED_SECRET: process.env.AGENT_SHARED_SECRET ?? "dev-secret",
};