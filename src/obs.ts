// Observabilidade: log estruturado + contadores. Sem dependência nenhuma.
//
// Uma linha JSON por evento, em stdout/stderr. Isso dá:
//   docker compose logs -f | jq 'select(.nivel == "erro")'
// E com OTEL_DENO=true o próprio Deno captura esses console.log como logs
// OpenTelemetry e instrumenta o Deno.serve com traces, sem mudar código.

type Nivel = "info" | "erro";

export const contadores = {
  requisicoes: 0,
  erros: 0,
  enviadas: 0,
  falhasDeEnvio: 0,
};

const inicio = Date.now();

export function log(
  nivel: Nivel,
  evento: string,
  dados: Record<string, unknown> = {},
) {
  const linha = JSON.stringify({
    ts: new Date().toISOString(),
    nivel,
    evento,
    ...dados,
  });
  if (nivel === "erro") console.error(linha);
  else console.log(linha);
}

/** Nunca logamos o payload: tem texto de mensagem e imagem em base64. */
export function detalhesDoErro(e: unknown) {
  return e instanceof Error
    ? { erro: e.message, tipo: e.name, stack: e.stack }
    : { erro: String(e) };
}

export function resumo() {
  const { rss, heapUsed } = Deno.memoryUsage();
  return {
    uptimeSegundos: Math.floor((Date.now() - inicio) / 1000),
    memoriaRssMb: Number((rss / 1048576).toFixed(1)),
    memoriaHeapMb: Number((heapUsed / 1048576).toFixed(1)),
    ...contadores,
  };
}
