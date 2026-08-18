// Conexão única com o WhatsApp + envio de mensagens.
import makeWASocket, {
  Browsers,
  DisconnectReason,
  type WASocket,
} from "baileys";
import qrcode from "qrcode-terminal";
import { Buffer } from "node:buffer";
import { decodeBase64 } from "@std/encoding/base64";
import { useKvAuthState } from "./auth-kv.ts";

type Logger = NonNullable<Parameters<typeof makeWASocket>[0]["logger"]>;

const silentLogger = (): Logger => ({
  level: "silent",
  child: () => silentLogger(),
  trace() {},
  debug() {},
  info() {},
  warn() {},
  error() {},
});

let sock: WASocket | null = null;
let online = false;

export const estaOnline = () => online;

/** Só os dígitos: aceita "+55 (62) 98557-8421" e devolve "5562985578421". */
export const soDigitos = (phone: string) => phone.replace(/\D/g, "");

/** Aceita data URI ("data:image/jpeg;base64,...") ou base64 puro. */
export function decodificaImagem(entrada: string): Uint8Array {
  const virgula = entrada.startsWith("data:") ? entrada.indexOf(",") + 1 : 0;
  return decodeBase64(entrada.slice(virgula));
}

export async function conectar(kv: Deno.Kv, sessao = "suporte") {
  const { state, saveCreds } = await useKvAuthState(kv, sessao);

  sock = makeWASocket({
    auth: state,
    browser: Browsers.ubuntu("Chrome"),
    logger: silentLogger(),
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", ({ connection, qr, lastDisconnect }) => {
    if (qr) qrcode.generate(qr, { small: true });
    if (connection === "open") {
      online = true;
      console.log("whatsapp conectado");
    }
    if (connection === "close") {
      online = false;
      const codigo = (lastDisconnect?.error as {
        output?: { statusCode?: number };
      })?.output?.statusCode;
      if (codigo === DisconnectReason.loggedOut) {
        console.log("deslogado — apague a sessão do KV e pareie de novo");
        return;
      }
      console.log("reconectando...");
      conectar(kv, sessao);
    }
  });
}

/** Resolve o JID real. Cobre o 9º dígito de celular brasileiro sem gambiarra. */
async function jidDe(phone: string): Promise<string | null> {
  const achado = (await sock!.onWhatsApp(soDigitos(phone)))?.[0];
  return achado?.exists ? achado.jid : null;
}

/** Retorna null se o número não existe no WhatsApp. */
export async function enviarTexto(phone: string, texto: string) {
  const jid = await jidDe(phone);
  if (!jid) return null;
  const msg = await sock!.sendMessage(jid, { text: texto });
  return { jid, id: msg?.key.id };
}

/** `imagem` é uma URL http(s) ou base64/data URI. */
export async function enviarImagem(
  phone: string,
  imagem: string,
  legenda: string,
) {
  const jid = await jidDe(phone);
  if (!jid) return null;
  // Baileys tipa a mídia como Buffer do Node; URL http ele mesmo baixa.
  const conteudo = imagem.startsWith("http")
    ? { url: imagem }
    : Buffer.from(decodificaImagem(imagem));
  const msg = await sock!.sendMessage(jid, {
    image: conteudo,
    caption: legenda,
  });
  return { jid, id: msg?.key.id };
}
