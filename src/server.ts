// API HTTP em Deno puro: Deno.serve + uma tabela de rotas. Sem framework.
import {
  conectar,
  configurarWa,
  desconectar,
  enviarArquivo,
  enviarImagem,
  enviarTexto,
  enviarTudo,
  estado,
  iniciar,
  logout,
  normalizarTelefone,
  numeroValido,
  obterKv,
} from "./wa.ts";
import { temSessaoValida } from "./auth-kv.ts";
import env from "./env.ts";
import {
  listarLeads,
  resumoLeads,
  salvarOuAtualizarLead,
  type StatusLead,
} from "./leads.ts";
import { contadores, detalhesDoErro, log, resumo } from "./obs.ts";

type Corpo = Record<string, unknown>;

let kvLocal: Deno.Kv | null = null;
async function getKv(): Promise<Deno.Kv> {
  const kv = obterKv();
  if (kv) return kv;
  if (!kvLocal) {
    kvLocal = await Deno.openKv(env().KV_PATH);
  }
  return kvLocal;
}

class HttpErro extends Error {
  constructor(readonly status: number, mensagem: string) {
    super(mensagem);
  }
}

const json = (corpo: unknown, status = 200) => Response.json(corpo, { status });

// ---------- validação de entrada ----------

function exigeTelefone(corpo: Corpo): string {
  const phone = normalizarTelefone(String(corpo.phone ?? ""));
  if (phone.length < 10 || phone.length > 18) {
    throw new HttpErro(400, "phone inválido");
  }
  return phone;
}

function exigeNumeros(corpo: Corpo): string[] {
  const lista = corpo.numeros;
  if (!Array.isArray(lista) || lista.length === 0) {
    throw new HttpErro(
      400,
      "numeros deve ser um array com pelo menos 1 telefone",
    );
  }
  const limpos = lista.map((p) => normalizarTelefone(String(p ?? "")));
  for (const phone of limpos) {
    if (phone.length < 10 || phone.length > 18) {
      throw new HttpErro(400, `phone inválido no lote: ${phone || "vazio"}`);
    }
  }
  return limpos;
}

function exigeTexto(corpo: Corpo, campo: string, genero = "o"): string {
  const valor = corpo[campo];
  if (typeof valor !== "string" || !valor) {
    throw new HttpErro(400, `${campo} obrigatóri${genero}`);
  }
  return valor;
}

function exigeTextoOuMensagem(corpo: Corpo): string {
  const texto = corpo.texto ?? corpo.mensagem;
  if (typeof texto !== "string" || !texto) {
    throw new HttpErro(400, "texto obrigatório");
  }
  return texto;
}

/** Envio devolve null quando o número não existe no WhatsApp. */
async function existente<T>(envio: Promise<T | null>): Promise<T> {
  const r = await envio;
  if (!r) throw new HttpErro(404, "número não está no whatsapp");
  return r;
}

// ---------- rotas ----------

const rotas: Record<string, (corpo: Corpo, req: Request) => unknown> = {
  "GET /": () => ({ mensagem: "Olá" }),

  "GET /status": () => ({ ...estado(), metricas: resumo() }),

  "GET /leads": async (_c, req) => {
    const url = new URL(req.url);
    const statusParam = url.searchParams.get("status") as StatusLead | null;
    const limiteStr = url.searchParams.get("limite");
    const limite = limiteStr ? parseInt(limiteStr, 10) : undefined;
    const kv = await getKv();
    const leads = await listarLeads(kv, {
      status: statusParam ?? undefined,
      limite,
    });
    return { total: leads.length, leads };
  },

  "GET /leads/resumo": async () => {
    const kv = await getKv();
    return await resumoLeads(kv);
  },

  "GET /leads/exportar": async (_c, req) => {
    const url = new URL(req.url);
    const statusParam = url.searchParams.get("status") as StatusLead | null;
    const formato = url.searchParams.get("formato") ?? "json";
    const kv = await getKv();
    const leads = await listarLeads(kv, {
      status: statusParam === ("todos" as unknown as StatusLead)
        ? undefined
        : (statusParam ?? "valido"),
    });
    const numeros = leads.map((l) => l.phone);
    if (formato === "txt") {
      return new Response(numeros.join("\n"), {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Content-Disposition": `attachment; filename="leads_${
            statusParam ?? "valido"
          }.txt"`,
        },
      });
    }
    return {
      total: numeros.length,
      status: statusParam ?? "valido",
      numeros,
    };
  },

  "POST /iniciar": (c) =>
    iniciar(c.phone === undefined ? undefined : exigeTelefone(c)),

  "POST /fechar": () => ({ finalizado: desconectar() }),

  "POST /logout": async () => ({ deslogado: await logout() }),

  "POST /numero-valido": async (c) => {
    const phone = exigeTelefone(c);
    const jid = await numeroValido(phone);
    const kv = await getKv();
    await salvarOuAtualizarLead(kv, {
      phone,
      jid: jid ?? undefined,
      status: jid ? "valido" : "sem_whatsapp",
      origem: "numero-valido",
    });
    return jid ? { existe: true, jid } : { existe: false };
  },

  "POST /enviar-mensagem": (c) =>
    existente(enviarTexto(exigeTelefone(c), exigeTexto(c, "texto"))),

  "POST /enviar-imagem": (c) =>
    existente(
      enviarImagem(
        exigeTelefone(c),
        exigeTexto(c, "imagem", "a"),
        String(c.legenda ?? ""),
        env().PASTA_ARQUIVOS,
      ),
    ),

  "POST /enviar-arquivo": (c) =>
    existente(
      enviarArquivo(
        exigeTelefone(c),
        env().PASTA_ARQUIVOS,
        exigeTexto(c, "arquivo"),
      ),
    ),

  "POST /enviar-tudo": (c) => {
    const numeros = exigeNumeros(c);
    const texto = exigeTextoOuMensagem(c);
    const imagem = typeof c.imagem === "string" && c.imagem
      ? c.imagem
      : undefined;
    const diasCooldown =
      typeof c.diasCooldown === "number" && c.diasCooldown > 0
        ? c.diasCooldown
        : undefined;
    // Executa em segundo plano para não dar timeout HTTP
    enviarTudo(numeros, texto, env().PASTA_ARQUIVOS, imagem, diasCooldown);
    return {
      status: "iniciado",
      total: numeros.length,
      diasCooldown: diasCooldown ?? null,
      mensagem:
        "Envio em lote iniciado em segundo plano com intervalo de segurança (30 a 45s).",
    };
  },
};

export async function rota(req: Request): Promise<Response> {
  const { pathname } = new URL(req.url);
  const handler = rotas[`${req.method} ${pathname}`];
  if (!handler) return json({ erro: "rota não encontrada" }, 404);

  let corpo: Corpo = {};
  if (req.method === "POST") {
    const bruto = await req.text();
    if (bruto) {
      try {
        corpo = JSON.parse(bruto);
      } catch {
        return json({ erro: "json inválido" }, 400);
      }
      if (typeof corpo !== "object" || corpo === null) {
        return json({ erro: "json inválido" }, 400);
      }
    }
  }

  try {
    const res = await handler(corpo, req);
    if (res instanceof Response) return res;
    return json(res ?? {});
  } catch (e) {
    if (e instanceof HttpErro) return json({ erro: e.message }, e.status);
    if (e instanceof Deno.errors.NotFound) {
      contadores.falhasDeEnvio++;
      return json({ erro: "arquivo não encontrado" }, 404);
    }
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("desconectado")) return json({ erro: msg }, 503);

    // Só 5xx é falha nossa: 4xx é o cliente mandando errado.
    contadores.erros++;
    log("erro", "excecao", { rota: pathname, ...detalhesDoErro(e) });
    return json({ erro: msg }, 500);
  }
}

/** Envolve `rota` com log de acesso. `rota` fica pura, e testável. */
export async function comObservabilidade(req: Request): Promise<Response> {
  const comeco = performance.now();
  contadores.requisicoes++;
  const res = await rota(req);
  log(res.status >= 500 ? "erro" : "info", "requisicao", {
    metodo: req.method,
    rota: new URL(req.url).pathname,
    status: res.status,
    ms: Number((performance.now() - comeco).toFixed(1)),
  });
  return res;
}

if (import.meta.main) {
  const { PORT, SESSAO, KV_PATH } = env();
  const kv = await Deno.openKv(KV_PATH);
  configurarWa(kv, SESSAO);

  const jaRegistrado = await temSessaoValida(kv, SESSAO);
  if (jaRegistrado) {
    log("info", "sessao_existente_reconectando", { sessao: SESSAO });
    await conectar(kv, SESSAO, { modo: "qr" });
  } else {
    log("info", "aguardando_iniciar", {
      sessao: SESSAO,
      mensagem: "Nenhuma sessão ativa. Chame POST /iniciar para conectar.",
    });
  }

  Deno.serve({
    port: PORT,
    onListen: ({ hostname, port }) =>
      log("info", "servidor_iniciado", {
        url: `http://${hostname}:${port}`,
        sessao: SESSAO,
        kv: KV_PATH ?? "padrão do Deno",
      }),
  }, comObservabilidade);
}
