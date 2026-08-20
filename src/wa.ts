// Conexão única com o WhatsApp + operações de envio.
import makeWASocket, {
  Browsers,
  DisconnectReason,
  type WASocket,
} from "baileys";
import { Buffer } from "node:buffer";
import qrcode from "qrcode-terminal";
import { decodeBase64 } from "@std/encoding/base64";
import { contentType } from "@std/media-types";
import { basename, extname, join } from "@std/path";
import { useKvAuthState } from "./auth-kv.ts";
import { contadores, log } from "./obs.ts";

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
let ultimoQr: string | null = null;
let desligadoDeProposito = false;
let ultimaDesconexao:
  | { quando: string; motivo: string; codigo?: number }
  | null = null;

// ---------- helpers puros (testáveis sem conexão) ----------

/** Só os dígitos: aceita "+55 (62) 98557-8421" e devolve "5562985578421". */
export const soDigitos = (phone: string) => phone.replace(/\D/g, "");

/** Aceita data URI ("data:image/jpeg;base64,...") ou base64 puro. */
export function decodificaImagem(entrada: string): Uint8Array {
  const virgula = entrada.startsWith("data:") ? entrada.indexOf(",") + 1 : 0;
  return decodeBase64(entrada.slice(virgula));
}

/** basename() corta "../" — o cliente não escolhe diretório, só o arquivo. */
export const caminhoSeguro = (pasta: string, arquivo: string) =>
  join(pasta, basename(arquivo));

export const tipoDoArquivo = (nome: string) =>
  contentType(extname(nome)) ?? "application/octet-stream";

// ---------- conexão ----------

export function estado() {
  return {
    online,
    sessaoIniciada: sock !== null,
    usuario: sock?.user ?? null,
    qrPendente: ultimoQr !== null,
    ultimaDesconexao,
  };
}

export async function conectar(kv: Deno.Kv, sessao: string) {
  desligadoDeProposito = false;
  const { state, saveCreds } = await useKvAuthState(kv, sessao);

  sock = makeWASocket({
    auth: state,
    browser: Browsers.ubuntu("Chrome"),
    logger: silentLogger(),
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", ({ connection, qr, lastDisconnect }) => {
    if (qr) {
      ultimoQr = qr;
      log("info", "qr_gerado", { sessao });
      // QR vai cru no stdout de propósito: dentro de JSON vira lixo ilegível.
      qrcode.generate(qr, { small: true });
    }
    if (connection === "open") {
      online = true;
      ultimoQr = null;
      log("info", "conectado", { sessao, usuario: sock?.user?.id });
    }
    if (connection === "close") {
      online = false;
      const codigo = (lastDisconnect?.error as {
        output?: { statusCode?: number };
      })?.output?.statusCode;
      const motivo = lastDisconnect?.error?.message ?? "desconhecido";
      ultimaDesconexao = { quando: new Date().toISOString(), motivo, codigo };

      if (desligadoDeProposito) {
        log("info", "desconectado", { sessao, motivo: "fechado via /fechar" });
        return;
      }

      if (codigo === DisconnectReason.loggedOut) {
        log("erro", "deslogado", {
          sessao,
          motivo,
          acao: "apague a sessão do KV e pareie de novo",
        });
        sock = null;
        return;
      }
      log("erro", "reconectando", { sessao, motivo, codigo });
      conectar(kv, sessao);
    }
  });
}

/** Fecha o socket sem desparear: a sessão continua válida no KV. */
export function desconectar() {
  if (!sock) return false;
  desligadoDeProposito = true;
  sock.end(undefined);
  sock = null;
  online = false;
  ultimoQr = null;
  return true;
}

/** QR atual, ou código de pareamento de 8 dígitos se `phone` for informado. */
export async function iniciar(phone?: string) {
  if (online) return { status: "já conectado", usuario: sock?.user ?? null };
  if (!sock) return { status: "sessão não iniciada" };
  if (phone) {
    return { codigo: await sock.requestPairingCode(soDigitos(phone)) };
  }
  return {
    qr: ultimoQr,
    status: ultimoQr ? "aguardando leitura" : "conectando",
  };
}

// ---------- envio ----------

function socket(): WASocket {
  if (!sock || !online) throw new Error("whatsapp desconectado");
  return sock;
}

/** Resolve o JID real. Cobre o 9º dígito de celular brasileiro sem gambiarra. */
export async function numeroValido(phone: string) {
  const achado = (await socket().onWhatsApp(soDigitos(phone)))?.[0];
  return achado?.exists ? achado.jid : null;
}

/** Retorna null se o número não existe no WhatsApp. */
export async function enviarTexto(phone: string, texto: string) {
  const jid = await numeroValido(phone);
  if (!jid) return null;
  const msg = await socket().sendMessage(jid, { text: texto });
  contadores.enviadas++;
  log("info", "enviado", { tipo: "texto", jid, id: msg?.key.id });
  return { jid, id: msg?.key.id };
}

/** Resolve imagem para o formato esperado pelo Baileys ({ url } ou Buffer). */
export async function resolverImagemConteudo(
  entrada: string,
  pastaArquivos?: string,
): Promise<{ url: string } | Buffer> {
  if (entrada.startsWith("http://") || entrada.startsWith("https://")) {
    return { url: entrada };
  }

  // Tenta ler como arquivo local dentro de pastaArquivos ou caminho direto
  if (pastaArquivos) {
    try {
      const caminho = caminhoSeguro(pastaArquivos, entrada);
      const bytes = await Deno.readFile(caminho);
      return Buffer.from(bytes);
    } catch {
      // Não é arquivo dentro da pasta
    }
  }

  try {
    const bytes = await Deno.readFile(entrada);
    return Buffer.from(bytes);
  } catch {
    // Não é caminho direto
  }

  // Trata como base64
  return Buffer.from(decodificaImagem(entrada));
}

/** `imagem` é uma URL http(s), caminho de arquivo ou base64/data URI. */
export async function enviarImagem(
  phone: string,
  imagem: string,
  legenda: string,
  pastaArquivos?: string,
) {
  const jid = await numeroValido(phone);
  if (!jid) return null;
  const conteudo = await resolverImagemConteudo(imagem, pastaArquivos);
  const msg = await socket().sendMessage(jid, {
    image: conteudo,
    caption: legenda,
  });
  contadores.enviadas++;
  log("info", "enviado", { tipo: "imagem", jid, id: msg?.key.id });
  return { jid, id: msg?.key.id };
}

/** Lê de `pasta`; `arquivo` é só o nome, sem caminho. */
export async function enviarArquivo(
  phone: string,
  pasta: string,
  arquivo: string,
) {
  const jid = await numeroValido(phone);
  if (!jid) return null;
  const caminho = caminhoSeguro(pasta, arquivo);
  const bytes = await Deno.readFile(caminho); // NotFound sobe pro server
  const msg = await socket().sendMessage(jid, {
    document: Buffer.from(bytes),
    mimetype: tipoDoArquivo(caminho),
    fileName: basename(arquivo),
  });
  contadores.enviadas++;
  log("info", "enviado", {
    tipo: "arquivo",
    jid,
    id: msg?.key.id,
    bytes: bytes.byteLength,
  });
  return { jid, id: msg?.key.id };
}

export const delayMs = (ms: number) =>
  ms > 0
    ? new Promise((resolve) => setTimeout(resolve, ms))
    : Promise.resolve();

export const tempoDeEsperaAleatorio = (min = 30, max = 45) =>
  Deno.env.get("DENO_ENV") === "test"
    ? 0
    : (Math.floor(Math.random() * (max - min + 1)) + min) * 1000;

/** Envio em lote assíncrono com delay anti-banimento (30-45s). */
export async function enviarTudo(
  numeros: string[],
  texto: string,
  pastaArquivos: string,
  imagem?: string,
) {
  log("info", "lote_iniciado", { total: numeros.length, temImagem: !!imagem });

  for (const [idx, num] of numeros.entries()) {
    try {
      if (imagem) {
        await enviarImagem(num, imagem, texto, pastaArquivos);
      } else {
        await enviarTexto(num, texto);
      }
    } catch (e) {
      log("erro", "falha_lote", {
        numero: num,
        indice: idx + 1,
        erro: e instanceof Error ? e.message : String(e),
      });
    }

    if (idx < numeros.length - 1) {
      const espera = tempoDeEsperaAleatorio(30, 45);
      log("info", "lote_aguardando", {
        segundos: espera / 1000,
        proximo: idx + 2,
        total: numeros.length,
      });
      await delayMs(espera);
    }
  }

  log("info", "lote_finalizado", { total: numeros.length });
}
