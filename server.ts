// API HTTP mínima. Rotas espelham as do projeto ../whatsapp-api.
import {
  conectar,
  enviarImagem,
  enviarTexto,
  estaOnline,
  soDigitos,
} from "./wa.ts";

const json = (corpo: unknown, status = 200) => Response.json(corpo, { status });

export async function rota(req: Request): Promise<Response> {
  const { pathname } = new URL(req.url);

  if (pathname === "/status") return json({ online: estaOnline() });

  // Rota e payload são validados antes da conexão: um pedido inválido é
  // inválido mesmo com o whatsapp fora do ar (e dá pra testar sem parear).
  const rotasDeEnvio = ["/enviar-mensagem", "/enviar-imagem"];
  if (req.method !== "POST" || !rotasDeEnvio.includes(pathname)) {
    return json({ erro: "rota não encontrada" }, 404);
  }

  const corpo = await req.json().catch(() => null);
  if (!corpo) return json({ erro: "json inválido" }, 400);

  const phone = soDigitos(String(corpo.phone ?? ""));
  if (phone.length < 10 || phone.length > 18) {
    return json({ erro: "phone inválido" }, 400);
  }

  if (pathname === "/enviar-mensagem") {
    const { texto } = corpo;
    if (typeof texto !== "string" || !texto) {
      return json({ erro: "texto obrigatório" }, 400);
    }
    if (!estaOnline()) return json({ erro: "whatsapp desconectado" }, 503);
    const r = await enviarTexto(phone, texto);
    return r ? json(r) : json({ erro: "número não está no whatsapp" }, 404);
  }

  if (pathname === "/enviar-imagem") {
    const { imagem, legenda } = corpo;
    if (typeof imagem !== "string" || !imagem) {
      return json({ erro: "imagem obrigatória" }, 400);
    }
    if (!estaOnline()) return json({ erro: "whatsapp desconectado" }, 503);
    const r = await enviarImagem(phone, imagem, String(legenda ?? ""));
    return r ? json(r) : json({ erro: "número não está no whatsapp" }, 404);
  }

  return json({ erro: "rota não encontrada" }, 404);
}

const handler = async (req: Request) => {
  try {
    return await rota(req);
  } catch (e) {
    console.error(e);
    return json({ erro: e instanceof Error ? e.message : String(e) }, 500);
  }
};

if (import.meta.main) {
  const kv = await Deno.openKv();
  await conectar(kv);
  Deno.serve({ port: Number(Deno.env.get("PORT") ?? 3000) }, handler);
}
