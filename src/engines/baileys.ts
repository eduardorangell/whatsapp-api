// Implementação do motor Baileys (WebSocket + Protocolo Signal nativo)
import makeWASocket, {
  Browsers,
  DisconnectReason,
  type WASocket,
} from "baileys";
import { Buffer } from "node:buffer";
import qrcode from "qrcode-terminal";
import { basename } from "@std/path";
import { bold, cyan, yellow } from "@std/fmt/colors";
import { limparSessao, temSessaoValida, useKvAuthState } from "../auth-kv.ts";
import { salvarOuAtualizarLead } from "../leads.ts";
import { contadores, log } from "../obs.ts";
import {
  caminhoSeguro,
  decodificaImagem,
  normalizarTelefone,
  resolverSpintax,
  tempoDigitandoMs,
  tipoDoArquivo,
} from "../util.ts";
import type {
  EstadoConexao,
  IniciarOpcoes,
  IniciarResultado,
  ResultadoEnvio,
  WhatsAppEngine,
} from "./types.ts";

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

export class BaileysEngine implements WhatsAppEngine {
  readonly tipo = "baileys" as const;

  private sock: WASocket | null = null;
  private online = false;
  private ultimoQr: string | null = null;
  private desligadoDeProposito = false;
  private ultimaDesconexao: {
    quando: string;
    motivo: string;
    codigo?: number;
  } | null = null;

  private kvConfig: Deno.Kv | null = null;
  private sessaoConfig: string = "default";
  private modoConexao: "qr" | "pairing" = "qr";
  private pastaArquivos: string = "./arquivos";

  constructor(kv?: Deno.Kv, sessao?: string, pastaArquivos?: string) {
    if (kv) this.kvConfig = kv;
    if (sessao) this.sessaoConfig = sessao;
    if (pastaArquivos) this.pastaArquivos = pastaArquivos;
  }

  public configurarKv(kv: Deno.Kv, sessao: string, pastaArquivos?: string) {
    this.kvConfig = kv;
    this.sessaoConfig = sessao;
    if (pastaArquivos) this.pastaArquivos = pastaArquivos;
  }

  public obterKv(): Deno.Kv | null {
    return this.kvConfig;
  }

  public async obterEstado(): Promise<EstadoConexao> {
    return await Promise.resolve({
      motor: "baileys",
      conectado: this.online,
      autenticado: this.sock !== null &&
        (this.sock.user !== null && this.sock.user !== undefined),
      telefone: this.sock?.user?.id
        ? this.sock.user.id.split(":")[0]
        : undefined,
      detalhes: {
        online: this.online,
        sessaoIniciada: this.sock !== null,
        usuario: this.sock?.user ?? null,
        qrPendente: this.ultimoQr !== null,
        ultimaDesconexao: this.ultimaDesconexao,
      },
    });
  }

  private socket(): WASocket {
    if (!this.sock || !this.online) {
      throw new Error("whatsapp desconectado");
    }
    return this.sock;
  }

  private async conectar(
    opcoes?: { modo?: "qr" | "pairing"; phone?: string },
  ): Promise<WASocket> {
    if (!this.kvConfig || !this.sessaoConfig) {
      throw new Error("KV ou sessão não configurados");
    }

    const s = this.sessaoConfig;
    const k = this.kvConfig;
    this.modoConexao = opcoes?.modo ?? "qr";
    this.desligadoDeProposito = false;

    if (this.sock) {
      try {
        this.sock.ev.removeAllListeners("connection.update");
        this.sock.ev.removeAllListeners("creds.update");
        this.sock.end(undefined);
      } catch {
        // Socket já encerrado
      }
      this.sock = null;
    }

    const { state, saveCreds } = await useKvAuthState(k, s);

    this.sock = makeWASocket({
      auth: state,
      browser: Browsers.ubuntu("Chrome"),
      logger: silentLogger(),
      syncFullHistory: false,
    });

    this.sock.ev.on("creds.update", saveCreds);

    this.sock.ev.on(
      "connection.update",
      ({ connection, qr, lastDisconnect }) => {
        if (qr && !this.online) {
          this.ultimoQr = qr;
          log("info", "qr_gerado", { motor: "baileys", sessao: s });
          if (this.modoConexao !== "pairing") {
            qrcode.generate(qr, { small: true });
          }
        }
        if (connection === "open") {
          this.online = true;
          this.ultimoQr = null;
          this.modoConexao = "qr";
          log("info", "conectado", {
            motor: "baileys",
            sessao: s,
            usuario: this.sock?.user?.id,
          });
        }
        if (connection === "close") {
          this.online = false;
          const codigo = (lastDisconnect?.error as {
            output?: { statusCode?: number };
          })?.output?.statusCode;
          const motivo = lastDisconnect?.error?.message ?? "desconhecido";
          this.ultimaDesconexao = {
            quando: new Date().toISOString(),
            motivo,
            codigo,
          };

          if (this.desligadoDeProposito) {
            log("info", "desconectado", {
              motor: "baileys",
              sessao: s,
              motivo: "fechado via /fechar",
            });
            return;
          }

          if (codigo === DisconnectReason.loggedOut) {
            log("erro", "deslogado", {
              motor: "baileys",
              sessao: s,
              motivo,
              acao: "apague a sessão do KV e pareie de novo",
            });
            void limparSessao(k, s);
            this.sock = null;
            return;
          }

          if (codigo === DisconnectReason.connectionReplaced) {
            log("erro", "conflito_sessao", {
              motor: "baileys",
              sessao: s,
              motivo:
                "sessão conectada em outro cliente (connectionReplaced 440)",
            });
            this.sock = null;
            return;
          }

          if (
            codigo === DisconnectReason.timedOut && motivo.includes("QR refs")
          ) {
            log("info", "qr_expirado", {
              motor: "baileys",
              sessao: s,
              motivo: "tempo limite de leitura do QR code expirou",
            });
            this.sock = null;
            return;
          }

          log("erro", "reconectando", {
            motor: "baileys",
            sessao: s,
            motivo,
            codigo,
          });
          this.conectar({ modo: this.modoConexao });
        }
      },
    );

    return this.sock;
  }

  public async iniciar(opcoes?: IniciarOpcoes): Promise<IniciarResultado> {
    if (this.online) {
      return {
        sucesso: true,
        mensagem: "já conectado",
      };
    }
    if (!this.kvConfig || !this.sessaoConfig) {
      return {
        sucesso: false,
        mensagem: "sessão não iniciada",
      };
    }

    await this.fechar();

    const jaRegistrado = await temSessaoValida(
      this.kvConfig,
      this.sessaoConfig,
    );
    if (!jaRegistrado) {
      await limparSessao(this.kvConfig, this.sessaoConfig);
    }

    const modo = opcoes?.phone ? "pairing" : "qr";
    const s = await this.conectar({ modo, phone: opcoes?.phone });

    const prontoOuQr = (u: { qr?: string; connection?: string }) =>
      Promise.resolve(Boolean(u.qr || u.connection === "open"));

    if (opcoes?.phone) {
      const cleanPhone = normalizarTelefone(opcoes.phone);
      try {
        await s.waitForConnectionUpdate(prontoOuQr, 15000);
        const rawCode = await s.requestPairingCode(cleanPhone);
        const codigo = rawCode?.match(/.{1,4}/g)?.join("-") || rawCode;

        log("info", "codigo_pareamento", { phone: cleanPhone, codigo });
        console.log(`\n${bold(cyan("=".repeat(45)))}`);
        console.log(
          `  ${bold("Código de Pareamento WhatsApp:")} ${bold(yellow(codigo))}`,
        );
        console.log(`${bold(cyan("=".repeat(45)))}\n`);

        return {
          sucesso: true,
          mensagem: "aguardando pareamento",
          pairingCode: codigo,
        };
      } catch (err) {
        log("erro", "falha_codigo_pareamento", { erro: String(err) });
        await this.fechar();
        await limparSessao(this.kvConfig, this.sessaoConfig);
        throw new Error(
          `Falha ao obter código de pareamento: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    try {
      await s.waitForConnectionUpdate(prontoOuQr, 5000);
    } catch {
      // Timeout inicial aceitável
    }

    return {
      sucesso: true,
      mensagem: this.ultimoQr ? "aguardando leitura" : "conectando",
      qrCode: this.ultimoQr ?? undefined,
    };
  }

  public async fechar(): Promise<boolean> {
    if (!this.sock) return await Promise.resolve(false);
    this.desligadoDeProposito = true;
    try {
      this.sock.end(undefined);
    } catch {
      // socket já pode estar fechado
    }
    this.sock = null;
    this.online = false;
    this.ultimoQr = null;
    return await Promise.resolve(true);
  }

  public async logout(): Promise<boolean> {
    if (this.sock) {
      try {
        await this.sock.logout("Logout solicitado");
      } catch {
        // Socket offline
      }
    }
    await this.fechar();
    if (this.kvConfig && this.sessaoConfig) {
      await limparSessao(this.kvConfig, this.sessaoConfig);
    }
    return true;
  }

  public async validarNumero(
    phone: string,
  ): Promise<{ existe: boolean; jid?: string }> {
    const achado = (await this.socket().onWhatsApp(normalizarTelefone(phone)))
      ?.[0];
    if (achado?.exists && achado.jid) {
      return { existe: true, jid: achado.jid };
    }
    return { existe: false };
  }

  private async simularDigitando(jid: string, texto: string) {
    const ms = tempoDigitandoMs(texto);
    if (ms <= 0) return;
    try {
      await this.socket().sendPresenceUpdate("composing", jid);
      await new Promise((res) => setTimeout(res, ms));
      await this.socket().sendPresenceUpdate("paused", jid);
    } catch {
      // Ignora falha de presença
    }
  }

  public async enviarTexto(
    phone: string,
    texto: string,
    origem = "enviar-mensagem",
  ): Promise<ResultadoEnvio> {
    const tel = normalizarTelefone(phone);
    const validacao = await this.validarNumero(tel);

    if (!validacao.existe || !validacao.jid) {
      if (this.kvConfig) {
        await salvarOuAtualizarLead(this.kvConfig, {
          phone: tel,
          status: "sem_whatsapp",
          origem,
        });
      }
      return {
        sucesso: false,
        destinatario: tel,
        mensagem: "Número não cadastrado no WhatsApp",
      };
    }

    const jid = validacao.jid;
    const textoFinal = resolverSpintax(texto);
    await this.simularDigitando(jid, textoFinal);

    const msg = await this.socket().sendMessage(jid, { text: textoFinal });
    contadores.enviadas++;
    log("info", "enviado", {
      motor: "baileys",
      tipo: "texto",
      jid,
      id: msg?.key.id,
    });

    if (this.kvConfig) {
      await salvarOuAtualizarLead(this.kvConfig, {
        phone: tel,
        jid,
        status: "enviado",
        origem,
        mensagemId: msg?.key.id ?? undefined,
      });
    }

    return {
      sucesso: true,
      id: msg?.key.id ?? undefined,
      destinatario: jid,
      timestamp: new Date().toISOString(),
    };
  }

  private async resolverImagemConteudo(
    entrada: string,
  ): Promise<{ url: string } | Buffer> {
    if (entrada.startsWith("http://") || entrada.startsWith("https://")) {
      return { url: entrada };
    }

    if (this.pastaArquivos) {
      try {
        const caminho = caminhoSeguro(this.pastaArquivos, entrada);
        const bytes = await Deno.readFile(caminho);
        return Buffer.from(bytes);
      } catch {
        // Prossegue
      }
    }

    try {
      const bytes = await Deno.readFile(entrada);
      return Buffer.from(bytes);
    } catch {
      // Trata como base64
    }

    const bytes = decodificaImagem(entrada);
    return Buffer.from(bytes);
  }

  public async enviarImagem(
    phone: string,
    imagem: string,
    legenda?: string,
    origem = "enviar-imagem",
  ): Promise<ResultadoEnvio> {
    const tel = normalizarTelefone(phone);
    const validacao = await this.validarNumero(tel);

    if (!validacao.existe || !validacao.jid) {
      if (this.kvConfig) {
        await salvarOuAtualizarLead(this.kvConfig, {
          phone: tel,
          status: "sem_whatsapp",
          origem,
        });
      }
      return {
        sucesso: false,
        destinatario: tel,
        mensagem: "Número não cadastrado no WhatsApp",
      };
    }

    const jid = validacao.jid;
    const legendaFinal = legenda ? resolverSpintax(legenda) : undefined;
    if (legendaFinal) {
      await this.simularDigitando(jid, legendaFinal);
    }

    const conteudo = await this.resolverImagemConteudo(imagem);
    const msg = await this.socket().sendMessage(jid, {
      image: conteudo,
      caption: legendaFinal,
    });
    contadores.enviadas++;
    log("info", "enviado", {
      motor: "baileys",
      tipo: "imagem",
      jid,
      id: msg?.key.id,
    });

    if (this.kvConfig) {
      await salvarOuAtualizarLead(this.kvConfig, {
        phone: tel,
        jid,
        status: "enviado",
        origem,
        mensagemId: msg?.key.id ?? undefined,
      });
    }

    return {
      sucesso: true,
      id: msg?.key.id ?? undefined,
      destinatario: jid,
      timestamp: new Date().toISOString(),
    };
  }

  public async enviarArquivo(
    phone: string,
    arquivo: string,
    legenda?: string,
    origem = "enviar-arquivo",
  ): Promise<ResultadoEnvio> {
    const tel = normalizarTelefone(phone);
    const validacao = await this.validarNumero(tel);

    if (!validacao.existe || !validacao.jid) {
      if (this.kvConfig) {
        await salvarOuAtualizarLead(this.kvConfig, {
          phone: tel,
          status: "sem_whatsapp",
          origem,
        });
      }
      return {
        sucesso: false,
        destinatario: tel,
        mensagem: "Número não cadastrado no WhatsApp",
      };
    }

    const jid = validacao.jid;
    const caminho = caminhoSeguro(this.pastaArquivos, arquivo);
    const bytes = await Deno.readFile(caminho);
    const msg = await this.socket().sendMessage(jid, {
      document: Buffer.from(bytes),
      mimetype: tipoDoArquivo(caminho),
      fileName: basename(arquivo),
      caption: legenda ? resolverSpintax(legenda) : undefined,
    });
    contadores.enviadas++;
    log("info", "enviado", {
      motor: "baileys",
      tipo: "arquivo",
      jid,
      id: msg?.key.id,
      bytes: bytes.byteLength,
    });

    if (this.kvConfig) {
      await salvarOuAtualizarLead(this.kvConfig, {
        phone: tel,
        jid,
        status: "enviado",
        origem,
        mensagemId: msg?.key.id ?? undefined,
      });
    }

    return {
      sucesso: true,
      id: msg?.key.id ?? undefined,
      destinatario: jid,
      timestamp: new Date().toISOString(),
    };
  }
}
