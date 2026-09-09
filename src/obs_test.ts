import { assertEquals, assertMatch, assertStringIncludes } from "@std/assert";
import {
  contadores,
  detalhesDoErro,
  deveUsarJson,
  formatarLog,
  log,
  resumo,
} from "./obs.ts";
import { comObservabilidade } from "./server.ts";

/** Captura o que sai no console durante `fn`. */
async function capturado(fn: () => unknown | Promise<unknown>) {
  const linhas: string[] = [];
  const { log: infoOriginal, error: erroOriginal } = console;
  console.log = (l: string) => linhas.push(l);
  console.error = (l: string) => linhas.push(l);
  try {
    await fn();
  } finally {
    console.log = infoOriginal;
    console.error = erroOriginal;
  }
  return linhas;
}

Deno.test("deveUsarJson detecta OpenTelemetry e LOG_FORMAT", () => {
  const originalEnv = Deno.env.get("DENO_ENV");
  const originalOtel = Deno.env.get("OTEL_DENO");
  const originalFormat = Deno.env.get("LOG_FORMAT");

  try {
    Deno.env.delete("DENO_ENV");

    Deno.env.set("LOG_FORMAT", "pretty");
    assertEquals(deveUsarJson(), false);

    Deno.env.set("LOG_FORMAT", "json");
    assertEquals(deveUsarJson(), true);

    Deno.env.delete("LOG_FORMAT");
    Deno.env.set("OTEL_DENO", "true");
    assertEquals(deveUsarJson(), true);
  } finally {
    if (originalEnv) Deno.env.set("DENO_ENV", originalEnv);
    else Deno.env.delete("DENO_ENV");

    if (originalOtel) Deno.env.set("OTEL_DENO", originalOtel);
    else Deno.env.delete("OTEL_DENO");

    if (originalFormat) Deno.env.set("LOG_FORMAT", originalFormat);
    else Deno.env.delete("LOG_FORMAT");
  }
});

Deno.test("log escreve uma linha JSON com ts, nivel e evento", async () => {
  const [linha] = await capturado(() => log("info", "teste", { a: 1 }));
  const obj = JSON.parse(linha);
  assertEquals(obj.nivel, "info");
  assertEquals(obj.evento, "teste");
  assertEquals(obj.a, 1);
  assertMatch(obj.ts, /^\d{4}-\d{2}-\d{2}T/);
});

Deno.test("formatarLog formata requisição e eventos com destaque", () => {
  const linhaReq = formatarLog("info", "requisicao", {
    metodo: "POST",
    rota: "/iniciar",
    status: 200,
    ms: 12.3,
  });
  assertStringIncludes(linhaReq, "POST");
  assertStringIncludes(linhaReq, "/iniciar");
  assertStringIncludes(linhaReq, "200");

  const linhaErro = formatarLog("erro", "excecao", {
    rota: "/status",
    erro: "falhou",
  });
  assertStringIncludes(linhaErro, "erro");
  assertStringIncludes(linhaErro, "falhou");
});

Deno.test("detalhesDoErro preserva mensagem, tipo e stack", () => {
  const d = detalhesDoErro(new TypeError("quebrou"));
  assertEquals(d.erro, "quebrou");
  assertEquals(d.tipo, "TypeError");
  assertStringIncludes(String(d.stack), "TypeError");
  assertEquals(detalhesDoErro("texto solto").erro, "texto solto");
});

Deno.test("resumo traz uptime, memória e contadores", () => {
  const r = resumo();
  assertEquals(typeof r.uptimeSegundos, "number");
  assertEquals(r.memoriaRssMb > 0, true);
  assertEquals(typeof r.requisicoes, "number");
});

Deno.test("requisição é logada e contada", async () => {
  const antes = contadores.requisicoes;
  const linhas = await capturado(() =>
    comObservabilidade(new Request("http://localhost/status"))
  );
  assertEquals(contadores.requisicoes, antes + 1);

  const acesso = linhas.map((l) => JSON.parse(l)).find((o) =>
    o.evento === "requisicao"
  );
  assertEquals(acesso.rota, "/status");
  assertEquals(acesso.metodo, "GET");
  assertEquals(acesso.status, 200);
  assertEquals(typeof acesso.ms, "number");
});

Deno.test("4xx não conta como erro nosso", async () => {
  const antes = contadores.erros;
  await capturado(() =>
    comObservabilidade(new Request("http://localhost/nada", { method: "POST" }))
  );
  assertEquals(contadores.erros, antes);
});

Deno.test("/status expõe métricas", async () => {
  const res = await comObservabilidade(new Request("http://localhost/status"));
  const corpo = await res.json();
  assertEquals(typeof corpo.metricas.uptimeSegundos, "number");
  assertEquals(corpo.online, false);
});
