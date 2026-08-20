import { create, Whatsapp } from "@wppconnect-team/wppconnect";
import { bold, red } from "@std/fmt/colors";
import { delay } from "@std/async";
import env, { logger } from "./util.ts";

import { extname } from "@std/path";
import { encodeBase64 } from "@std/encoding";

export class WhatsappService {
  private exportedClient!: Whatsapp;
  private initialized: boolean = false;

  constructor() {}

  /**
   * @description Inicia a instância Whatsapp
   * @param phoneNumber?: string sendo uma string opcional
   * @return string
   */
  public async initWhatsapp(phoneNumber?: string): Promise<string> {
    if (this.initialized) {
      return "Instância já inicializada";
    } else {
      this.exportedClient = await create({
        session: "suporte",
        phoneNumber: phoneNumber,
        catchLinkCode: (linkCode) => {
          logger.log("Link code: ", linkCode);
        },
        catchQR: (_base64Qrimg, asciiQR, attempts, _urlCode) => {
          logger.log(
            "Number of attempts to read the qrcode: ",
            attempts,
          );
          logger.log(`Terminal qrcode: \n${asciiQR}`);
        },
        statusFind: (statusSession, session) => {
          logger.log("Status Session: ", statusSession);
          logger.log("Session name: ", session);
        },
        onLoadingScreen: (percent, message) => {
          logger.log("LOADING SCREEN", percent, message);
        },
        whatsappVersion: env().WHATSAPP_VERSION,
        folderNameToken: "tokens",
        headless: env().HEADLESS,
        devtools: false,
        useChrome: env().USE_CHROME,
        debug: false,
        browserWS: "",
        browserArgs: [
          "--disable-web-security",
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-features=MacRouters",
          "--disable-web-security",
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
          "--ignore-certificate-errors-spki-list",
          "--disable-features=LeakyPeeker",
        ],
        puppeteerOptions: {},
        logQR: env().LOG_QR,
        disableWelcome: true,
        updatesLog: true,
        autoClose: env().AUTO_CLOSE,
        waitForLogin: env().WAIT_FOR_LOGIN,
      });

      // Alteração de estado de conexão
      this.exportedClient.onStateChange((state) => {
        logger.log("State changed: ", state);
        if ("CONFLICT".includes(state)) this.exportedClient.useHere();
        if ("UNPAIRED".includes(state)) logger.log("logout");
        if ("CONNECTED".includes(state)) this.initialized = true;
      });

      // Reposta de chamada
      this.exportedClient.onIncomingCall((call) => {
        logger.log(call);
        this.exportedClient.sendText(
          call.peerJid,
          "Me desculpe, eu ainda não posso receber ligações",
        );
      });

      const exitHandler = async () => {
        await this.exportedClient.close();
        logger.log(`${bold(red("Client closed"))}`);
        Deno.exit(0); // Ensure process exits cleanly
      };

      // Handle termination signals
      Deno.addSignalListener("SIGINT", exitHandler); // Ctrl+C
      Deno.addSignalListener("SIGTERM", exitHandler); // System termination

      return new Promise((resolve) => {
        if (this.initialized) {
          resolve("Inicializado");
        } else {
          const checkInterval = setInterval(() => {
            if (this.initialized) {
              clearInterval(checkInterval);
              resolve("Inicializado");
            }
          }, 1000); // Check every second
        }
      });
    }
  }

  /**
   * @description Verifica se o número é válido
   * @param phone - string
   * @return object
   */
  public async validNumber(phone: string) {
    const numero = this.converteNumero(phone);
    return await this.exportedClient.checkNumberStatus(numero);
  }

  /**
   * @description Envia mensagem para um número
   * @param phone - string
   * @param text - string
   * @return object
   */
  public async sendText(phone: string, text: string) {
    const resultNumero = await this.validNumber(this.converteNumero(phone));
    if (resultNumero.status === 200) {
      try {
        return await this.exportedClient.sendText(
          resultNumero.id._serialized,
          text,
        );
      } catch (error) {
        throw error;
      }
    } else {
      return resultNumero;
    }
  }

  /**
   * @description Resolve entrada de imagem (URL, caminho de arquivo local ou Base64) para Data URI
   */
  private async resolverImagem(entrada?: string): Promise<string | undefined> {
    if (!entrada) return undefined;

    // 1. URL HTTP ou HTTPS
    if (entrada.startsWith("http://") || entrada.startsWith("https://")) {
      const res = await fetch(entrada);
      if (!res.ok) {
        throw new Error(`Falha ao baixar imagem da URL: ${res.statusText}`);
      }
      const buf = await res.arrayBuffer();
      const mime = res.headers.get("content-type") ?? "image/jpeg";
      return `data:${mime};base64,${encodeBase64(new Uint8Array(buf))}`;
    }

    // 2. Data URI já pronta
    if (entrada.startsWith("data:image/")) {
      return entrada;
    }

    // 3. Arquivo local no disco (caminho direto ou na pasta ./arquivos)
    try {
      const bytes = await Deno.readFile(entrada);
      const ext = extname(entrada).replace(".", "").toLowerCase();
      const mime = ext === "png"
        ? "image/png"
        : ext === "webp"
        ? "image/webp"
        : "image/jpeg";
      return `data:${mime};base64,${encodeBase64(bytes)}`;
    } catch {
      try {
        const caminhoArquivos = `./arquivos/${entrada}`;
        const bytes = await Deno.readFile(caminhoArquivos);
        const ext = extname(caminhoArquivos).replace(".", "").toLowerCase();
        const mime = ext === "png"
          ? "image/png"
          : ext === "webp"
          ? "image/webp"
          : "image/jpeg";
        return `data:${mime};base64,${encodeBase64(bytes)}`;
      } catch {
        // Não é arquivo local
      }
    }

    // 4. Base64 puro sem cabeçalho data:
    return `data:image/jpeg;base64,${entrada}`;
  }

  public async enviarTudo(
    numeros: string[],
    texto: string,
    imagemEntrada?: string,
  ) {
    let imagem: string | undefined;

    if (imagemEntrada) {
      try {
        imagem = await this.resolverImagem(imagemEntrada);
      } catch (err) {
        console.error(
          `[ERRO] Falha ao processar imagem para envio em lote:`,
          err,
        );
      }
    }

    console.log(`[LOTE] Iniciando envio para ${numeros.length} números...`);

    for (const [idx, num] of numeros.entries()) {
      console.log(`[${idx + 1}/${numeros.length}] - Enviando para: ${num}`);
      try {
        if (imagem) {
          const result = await this.sendImage(num, imagem, texto);
          console.log(result);
        } else {
          const result = await this.sendText(num, texto);
          console.log(result);
        }
      } catch (err) {
        console.error(`[ERRO] Falha ao enviar para ${num}:`, err);
      }

      if (idx < numeros.length - 1) {
        const tempoEspera = this.gerarTempoDeDigitacao(30, 45);
        console.log(
          `Aguardando ${tempoEspera / 1000}s antes do próximo envio...`,
        );
        await delay(tempoEspera);
      }
    }

    console.log(`[LOTE] Envio em lote finalizado.`);
  }

  /**
   * @description Envia imagem para um número (aceita URL, caminho de arquivo ou base64)
   * @param phone - string
   * @param image - string (url, caminho ou base64)
   * @param caption - string
   * @return object
   */
  public async sendImage(phone: string, image: string, caption: string) {
    const resultNumero = await this.validNumber(this.converteNumero(phone));
    if (resultNumero.status === 200) {
      try {
        const imagemBase64 = (await this.resolverImagem(image)) ?? image;
        return await this.exportedClient.sendImageFromBase64(
          resultNumero.id._serialized,
          imagemBase64,
          `${crypto.randomUUID()}.png`,
          caption,
        );
      } catch (error) {
        throw error;
      }
    } else {
      return resultNumero;
    }
  }

  /**
   * @description Enviar um arquivo
   * @param phone - string
   * @param file - string
   * @return object
   */
  public async sendFile(phone: string, file: string) {
    const resultNumero = await this.validNumber(this.converteNumero(phone));
    if (resultNumero.status === 200) {
      try {
        const filePath = await Deno.realPath(`./arquivos/${file}`);
        return await this.exportedClient.sendFile(
          resultNumero.id._serialized,
          filePath,
        );
      } catch (error) {
        throw error;
      }
    } else {
      return resultNumero;
    }
  }

  /**
   * Gera um número em milisegundos inteiro aleatório entre um intervalo definido (inclusive).
   * @param min Valor mínimo do intervalo
   * @param max Valor máximo do intervalo
   * @returns Número inteiro entre min e max
   */
  private gerarTempoDeDigitacao(min: number, max: number): number {
    return ((Math.floor(Math.random() * (max - min + 1)) + min) * 1000);
  }

  /* Converte o número para JiD */
  private converteNumero(phone: string) {
    return `${phone?.replace(/\D/g, "")}@c.us`;
  }

  /**
   * @description Checa o status de conexão do Whatsapp
   * @return object
   */
  public async getStatus() {
    if (this.initialized) {
      return {
        isOnline: await this.exportedClient.isOnline(),
        isLoggedIn: await this.exportedClient.isLoggedIn(),
        isMainInit: await this.exportedClient.isMainInit(),
        isConnected: await this.exportedClient.isConnected(),
        isMainReady: await this.exportedClient.isMainReady(),
        isMainLoaded: await this.exportedClient.isMainLoaded(),
      };
    }
    return {
      isInit: this.initialized,
    };
  }

  public async closeWhatsapp() {
    if (!this.initialized) return true;
    const status = await this.exportedClient.close();
    if (status) {
      this.initialized = false;
      return status;
    }
  }
}
