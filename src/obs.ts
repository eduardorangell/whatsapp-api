// Observabilidade: log estruturado + contadores. Sem dependência nenhuma.
//
// Uma linha JSON por evento, em stdout/stderr. Isso dá:
//   docker compose logs -f | jq 'select(.nivel == "erro")'
// E com OTEL_DENO=true o próprio Deno captura esses console.log como logs
// OpenTelemetry e instrumenta o Deno.serve com traces, sem mudar código.

import { bold, cyan, gray, green, magenta, red, yellow } from "@std/fmt/colors";

type Nivel = "info" | "erro";

export const contadores = {
  requisicoes: 0,
  erros: 0,
  enviadas: 0,
  falhasDeEnvio: 0,
};

const inicio = Date.now();

function colorirValor(chave: string, valor: unknown): string {
  if (valor === null || valor === undefined) return gray(String(valor));
  if (chave === "nivel") {
    return valor === "erro"
      ? bold(red(`"${valor}"`))
      : bold(green(`"${valor}"`));
  }
  if (chave === "status" && typeof valor === "number") {
    if (valor >= 500) return bold(red(String(valor)));
    if (valor >= 400) return bold(yellow(String(valor)));
    return bold(green(String(valor)));
  }
  if (chave === "ts") return gray(`"${valor}"`);
  if (chave === "evento") return bold(cyan(`"${valor}"`));
  if (chave === "metodo") return bold(yellow(`"${valor}"`));
  if (chave === "rota") return cyan(`"${valor}"`);
  if (chave === "erro" && typeof valor === "string") {
    return bold(red(`"${valor}"`));
  }
  if (typeof valor === "number") return magenta(String(valor));
  if (typeof valor === "boolean") return valor ? green("true") : red("false");
  if (typeof valor === "string") return green(`"${valor}"`);
  return gray(JSON.stringify(valor));
}

export function formatarLog(
  nivel: Nivel,
  evento: string,
  dados: Record<string, unknown> = {},
): string {
  const objeto: Record<string, unknown> = {
    ts: new Date().toISOString(),
    nivel,
    evento,
    ...dados,
  };

  const partes = Object.entries(objeto).map(([k, v]) => {
    return `${cyan(`"${k}"`)}${gray(":")}${colorirValor(k, v)}`;
  });

  return `${gray("{")}${partes.join(gray(","))}${gray("}")}`;
}

/**
 * Determina se deve emitir JSON estruturado puro ou texto estilizado com cores.
 * Quando o OpenTelemetry está ativo, JSON puro garante que coletores (OTLP, Datadog, Loki)
 * indexem todos os campos e atributos sem sujeira de caracteres ANSI.
 */
export function deveUsarJson(): boolean {
  const formato = Deno.env.get("LOG_FORMAT")?.toLowerCase();
  if (formato === "json") return true;
  if (formato === "pretty") return false;
  if (Deno.env.get("DENO_ENV") === "test") return true;

  // Se o OpenTelemetry estiver ativado, emite JSON puro
  if (
    Deno.env.get("OTEL_DENO") === "true" ||
    Boolean(Deno.env.get("OTEL_EXPORTER_OTLP_ENDPOINT")) ||
    Boolean(Deno.env.get("OTEL_EXPORTER_OTLP_LOGS_ENDPOINT"))
  ) {
    return true;
  }

  return false;
}

export function log(
  nivel: Nivel,
  evento: string,
  dados: Record<string, unknown> = {},
) {
  if (deveUsarJson()) {
    const linha = JSON.stringify({
      ts: new Date().toISOString(),
      nivel,
      evento,
      ...dados,
    });
    if (nivel === "erro") console.error(linha);
    else console.log(linha);
    return;
  }

  const linhaFormatada = formatarLog(nivel, evento, dados);
  if (nivel === "erro") console.error(linhaFormatada);
  else console.log(linhaFormatada);
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
