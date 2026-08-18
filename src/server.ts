// API HTTP em Deno puro: Deno.serve + uma tabela de rotas. Sem framework.
import {
  conectar,
  desconectar,
  enviarArquivo,
  enviarImagem,
  enviarTexto,
  estado,
  iniciar,
  numeroValido,
  soDigitos,
} from "./wa.ts";
import env from "./env.ts";

type Corpo = Record<string, unknown>;

class HttpErro extends Error {
  constructor(readonly status: number, mensagem: string) {
    super(mensagem);
  }
}

const json = (corpo: unknown, status = 200) => Response.json(corpo, { status });

// ---------- validação de entrada ----------

function exigeTelefone(corpo: Corpo): string {
  const phone = soDigitos(String(corpo.phone ?? ""));
  if (phone.length < 10 || phone.length > 18) {
    throw new HttpErro(400, "phone inválido");
  }
  return phone;
}

function exigeTexto(corpo: Corpo, campo: string, genero = "o"): string {
  const valor = corpo[campo];
  if (typeof valor !== "string" || !valor) {
    throw new HttpErro(400, `${campo} obrigatóri${genero}`);
  }
  return valor;
}

/** Envio devolve null quando o número não existe no WhatsApp. */
async function existente<T>(envio: Promise<T | null>): Promise<T> {
  const r = await envio;
  if (!r) throw new HttpErro(404, "número não está no whatsapp");
  return r;
}

// ---------- rotas ----------

const rotas: Record<string, (corpo: Corpo) => unknown> = {
  "GET /": () => ({ mensagem: "Olá" }),

  "GET /status": () => estado(),

  "POST /iniciar": (c) =>
    iniciar(c.phone === undefined ? undefined : exigeTelefone(c)),

  "POST /fechar": () => ({ finalizado: desconectar() }),

  "POST /numero-valido": async (c) => {
    const jid = await numeroValido(exigeTelefone(c));
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
    return json(await handler(corpo) ?? {});
  } catch (e) {
    if (e instanceof HttpErro) return json({ erro: e.message }, e.status);
    if (e instanceof Deno.errors.NotFound) {
      return json({ erro: "arquivo não encontrado" }, 404);
    }
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("desconectado")) return json({ erro: msg }, 503);
    console.error(e);
    return json({ erro: msg }, 500);
  }
}

if (import.meta.main) {
  const { PORT, SESSAO, KV_PATH } = env();
  const kv = await Deno.openKv(KV_PATH);
  await conectar(kv, SESSAO);
  Deno.serve({
    port: PORT,
    onListen: ({ hostname, port }) =>
      console.log(`servidor em http://${hostname}:${port}`),
  }, rota);
}
