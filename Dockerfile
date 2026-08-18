FROM denoland/deno:2.9.5

WORKDIR /app

# Sem Chrome, sem fontes, sem apt-get. Era isso que o Puppeteer exigia.
COPY deno.json deno.lock ./
RUN deno install

COPY src/ ./src/

# KV_PATH aponta pro volume: é o único lugar que precisa de escrita.
ENV KV_PATH=/data/kv.sqlite3
ENV PASTA_ARQUIVOS=/arquivos
EXPOSE 3000

# /status responde 200 mesmo desconectado do WhatsApp — é a saúde do processo,
# não da sessão. Para a sessão, olhe o campo "online" na resposta.
# `deno eval` já roda com permissões, não aceita --allow-*. A imagem não tem curl.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["deno", "eval", \
    "const r = await fetch('http://localhost:3000/status'); Deno.exit(r.ok ? 0 : 1)"]

# --unstable-otel fica ligado sempre, mas só age com OTEL_DENO=true.
CMD ["run", \
  "--allow-net", \
  "--allow-env", \
  "--allow-read", \
  "--allow-sys", \
  "--allow-write=/data", \
  "--unstable-kv", \
  "--unstable-otel", \
  "src/server.ts"]
