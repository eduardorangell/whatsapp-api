// Implementação do motor WPPConnect (Google Chrome / Puppeteer)
import { create, type Whatsapp } from "@wppconnect-team/wppconnect";
import { bold, cyan, yellow } from "@std/fmt/colors";
import { basename } from "@std/path";
import { salvarOuAtualizarLead } from "../leads.ts";
import { contadores, log } from "../obs.ts";
import {
  caminhoSeguro,
  normalizarTelefone,
  resolverImagemParaDataUri,
  resolverSpintax,
  soDigitos,
  tempoDigitandoMs,
} from "../util.ts";
import type {
  EstadoConexao,
  IniciarOpcoes,
  IniciarResultado,
  ResultadoEnvio,
  WhatsAppEngine,
} from "./types.ts";

export class WppConnectEngine implements WhatsAppEngine {
  readonly tipo = "wppconnect" as const;

  private client: Whatsapp | null = null;
  private online = false;
  private inicializado = false;
  private ultimoQr: string | null = null;
  private ultimoPairingCode: string | null = null;
  private kvConfig: Deno.Kv | null = null;
  private sessaoConfig: string = "suporte";
  private pastaArquivos: string = "./arquivos";
  private pastaTokens: string = Deno.env.get("WPP_TOKENS_DIR") ||
    "./data/tokens";

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
    let conectado = false;
    let autenticado = false;

    if (this.client && this.inicializado) {
      try {
        conectado = await this.client.isConnected();
        autenticado = await this.client.isLoggedIn();
      } catch {
        // Ignora erro ao inspecionar status
      }
    }

    return {
      motor: "wppconnect",
      conectado: conectado || this.online,
      autenticado,
      telefone: undefined,
      detalhes: {
        inicializado: this.inicializado,
        qrPendente: this.ultimoQr !== null,
        pastaTokens: this.pastaTokens,
      },
    };
  }

  public async iniciar(opcoes?: IniciarOpcoes): Promise<IniciarResultado> {
    if (this.inicializado && this.client) {
      const isConnected = await this.client.isConnected().catch(() => false);
      if (isConnected) {
        return { sucesso: true, mensagem: "já conectado" };
      }
    }

    const phoneLimpo = opcoes?.phone
      ? soDigitos(normalizarTelefone(opcoes.phone))
      : undefined;

    this.ultimoQr = null;
    this.ultimoPairingCode = null;

    try {
      this.client = await create({
        session: this.sessaoConfig,
        phoneNumber: phoneLimpo,
        folderNameToken: this.pastaTokens,
        catchLinkCode: (linkCode: string) => {
          this.ultimoPairingCode = linkCode;
          log("info", "codigo_pareamento", {
            motor: "wppconnect",
            phone: phoneLimpo,
            codigo: linkCode,
          });
          console.log(`\n${bold(cyan("=".repeat(45)))}`);
          console.log(
            `  ${bold("Código de Pareamento WPPConnect:")} ${
              bold(yellow(linkCode))
            }`,
          );
          console.log(`${bold(cyan("=".repeat(45)))}\n`);
        },
        catchQR: (_base64Qrimg: string, asciiQR: string, attempts: number) => {
          this.ultimoQr = asciiQR;
          log("info", "qr_gerado", {
            motor: "wppconnect",
            sessao: this.sessaoConfig,
            tentativa: attempts,
          });
          if (!phoneLimpo) {
            console.log(
              `\n[QR CODE] Tentativa ${attempts} para leitura:\n${asciiQR}`,
            );
          }
        },
        statusFind: (statusSession: string, session: string) => {
          log("info", "status_sessao", {
            motor: "wppconnect",
            status: statusSession,
            sessao: session,
          });
        },
        headless: Deno.env.get("HEADLESS") !== "false",
        devtools: false,
        useChrome: Deno.env.get("USE_CHROME") !== "false",
        debug: false,
        browserWS: Deno.env.get("BROWSER_WS") || "",
        browserArgs: [
          "--disable-web-security",
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-features=MacRouters",
          "--aggressive-cache-discard",
          "--disable-cache",
          "--disable-application-cache",
          "--disable-offline-load-stale-cache",
          "--disk-cache-size=0",
          "--disable-background-networking",
          "--disable-default-apps",
          "--disable-extensions",
          "--disable-sync",
          "--disable-translate",
          "--hide-scrollbars",
          "--metrics-recording-only",
          "--mute-audio",
          "--no-first-run",
          "--safebrowsing-disable-auto-update",
          "--ignore-certificate-errors",
          "--ignore-ssl-errors",
        ],
        puppeteerOptions: {},
        logQR: true,
        disableWelcome: true,
        updatesLog: false,
      });

      this.client.onStateChange((state: string) => {
        log("info", "estado_alterado", { motor: "wppconnect", state });
        if (state.includes("CONFLICT")) this.client?.useHere();
        if (state.includes("CONNECTED")) {
          this.online = true;
          this.inicializado = true;
          this.ultimoQr = null;
        }
        if (state.includes("UNPAIRED")) {
          this.online = false;
          this.inicializado = false;
        }
      });

      this.inicializado = true;
      this.online = true;

      return {
        sucesso: true,
        mensagem: phoneLimpo
          ? "aguardando pareamento"
          : (this.ultimoQr ? "aguardando leitura" : "conectado"),
        pairingCode: this.ultimoPairingCode ?? undefined,
        qrCode: this.ultimoQr ?? undefined,
      };
    } catch (err) {
      log("erro", "falha_iniciar_wppconnect", {
        erro: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  public async fechar(): Promise<boolean> {
    if (!this.client) return false;
    try {
      await this.client.close();
    } catch {
      // Ignora erro ao fechar
    }
    this.client = null;
    this.online = false;
    this.inicializado = false;
    this.ultimoQr = null;
    return true;
  }

  public async logout(): Promise<boolean> {
    if (this.client) {
      try {
        await this.client.logout();
      } catch {
        // Ignora
      }
    }
    return await this.fechar();
  }

  private converterParaJid(phone: string): string {
    const limpo = soDigitos(normalizarTelefone(phone));
    return `${limpo}@c.us`;
  }

  public async validarNumero(
    phone: string,
  ): Promise<{ existe: boolean; jid?: string }> {
    if (!this.client || !this.inicializado) {
      throw new Error("whatsapp desconectado");
    }
    const jid = this.converterParaJid(phone);
    try {
      const status = await this.client.checkNumberStatus(jid);
      if (status && status.status === 200 && status.id?._serialized) {
        return { existe: true, jid: status.id._serialized };
      }
      return { existe: false };
    } catch {
      return { existe: false };
    }
  }

  public async enviarTexto(
    phone: string,
    texto: string,
    origem = "enviar-mensagem",
  ): Promise<ResultadoEnvio> {
    if (!this.client || !this.inicializado) {
      throw new Error("whatsapp desconectado");
    }

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

    // Simula tempo de digitação se necessário
    const ms = tempoDigitandoMs(textoFinal);
    if (ms > 0) {
      await new Promise((res) => setTimeout(res, ms));
    }

    const resultado = await this.client.sendText(jid, textoFinal);
    contadores.enviadas++;
    log("info", "enviado", {
      motor: "wppconnect",
      tipo: "texto",
      jid,
      id: resultado?.id,
    });

    if (this.kvConfig) {
      await salvarOuAtualizarLead(this.kvConfig, {
        phone: tel,
        jid,
        status: "enviado",
        origem,
        mensagemId: resultado?.id ?? undefined,
      });
    }

    return {
      sucesso: true,
      id: resultado?.id ?? undefined,
      destinatario: jid,
      timestamp: new Date().toISOString(),
    };
  }

  public async enviarImagem(
    phone: string,
    imagem: string,
    legenda?: string,
    origem = "enviar-imagem",
  ): Promise<ResultadoEnvio> {
    if (!this.client || !this.inicializado) {
      throw new Error("whatsapp desconectado");
    }

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
    const legendaFinal = legenda ? resolverSpintax(legenda) : "";
    const dataUri = await resolverImagemParaDataUri(imagem, this.pastaArquivos);

    const nomeArquivo = `${crypto.randomUUID()}.jpeg`;
    const resultado = await this.client.sendFile(jid, dataUri, {
      filename: nomeArquivo,
      caption: legendaFinal,
    });
    contadores.enviadas++;
    log("info", "enviado", {
      motor: "wppconnect",
      tipo: "imagem",
      jid,
      id: resultado?.id,
    });

    if (this.kvConfig) {
      await salvarOuAtualizarLead(this.kvConfig, {
        phone: tel,
        jid,
        status: "enviado",
        origem,
        mensagemId: resultado?.id ?? undefined,
      });
    }

    return {
      sucesso: true,
      id: resultado?.id ?? undefined,
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
    if (!this.client || !this.inicializado) {
      throw new Error("whatsapp desconectado");
    }

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
    const resultado = await this.client.sendFile(jid, caminho, {
      filename: basename(arquivo),
      caption: legenda ? resolverSpintax(legenda) : undefined,
    });
    contadores.enviadas++;
    log("info", "enviado", {
      motor: "wppconnect",
      tipo: "arquivo",
      jid,
      id: resultado?.id,
    });

    if (this.kvConfig) {
      await salvarOuAtualizarLead(this.kvConfig, {
        phone: tel,
        jid,
        status: "enviado",
        origem,
        mensagemId: resultado?.id ?? undefined,
      });
    }

    return {
      sucesso: true,
      id: resultado?.id ?? undefined,
      destinatario: jid,
      timestamp: new Date().toISOString(),
    };
  }
}
