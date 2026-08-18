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

CMD ["run", \
  "--allow-net", \
  "--allow-env", \
  "--allow-read", \
  "--allow-sys", \
  "--allow-write=/data", \
  "--unstable-kv", \
  "src/server.ts"]
