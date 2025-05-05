import { create, Whatsapp } from "@wppconnect-team/wppconnect";
import { bold, red } from "@std/fmt/colors";
import env, { logger } from "./util.ts";

export class WhatsappService {
  private exportedClient!: Whatsapp;

  constructor() {
    this.initWhatsapp();
  }

  private initWhatsapp() {
    create({
      session: "suporte",
      phoneNumber: env().PHONE_NUMBER,
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
      puppeteerOptions: {
        headless: "shell",
      },
      logQR: env().LOG_QR,
      disableWelcome: true,
      updatesLog: true,
      autoClose: env().AUTO_CLOSE,
      waitForLogin: env().WAIT_FOR_LOGIN,
    }).then((client) => {
      // Exportando client para uma variável privada a classe
      this.exportedClient = client;

      // Respostas para chamadas
      client.onStateChange((state) => {
        logger.log("State changed: ", state);
        if ("CONFLICT".includes(state)) client.useHere();
        if ("UNPAIRED".includes(state)) logger.log("logout");
      });

      // Função para responder a tentativas de chamada
      client.onIncomingCall((call) => {
        logger.log(call);
        client.sendText(
          call.peerJid,
          "Me desculpe, eu ainda não posso receber ligações",
        );
      });
      const exitHandler = async () => {
        await client.close();
        logger.log(`${bold(red("Client closed"))}`);
        Deno.exit(0); // Ensure process exits cleanly
      };

      // Handle termination signals
      Deno.addSignalListener("SIGINT", exitHandler); // Ctrl+C
      Deno.addSignalListener("SIGTERM", exitHandler); // System termination
    }).catch((error) => {
      logger.error(error);
    });
  }

  /**
   * @description Valida se o número é válido
   * @param phone - string
   * @returns object
   */
  public async validNumber(phone: string) {
    const numero = this.converteNumero(phone);
    return await this.exportedClient.checkNumberStatus(numero);
  }

  /**
   * @description Envia mensagem para um número
   * @param phone - string
   * @param text - string
   * @returns object
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
      return "Número inválido";
    }
  }

  /**
   * @description Envia imagem para um número
   * @param phone - string
   * @param image - string base 64
   * @param caption - string
   * @returns object
   */
  public async sendImage(phone: string, image: string, caption: string) {
    const resultNumero = await this.validNumber(this.converteNumero(phone));
    if (resultNumero.status === 200) {
      try {
        return await this.exportedClient.sendImageFromBase64(
          resultNumero.id._serialized,
          image,
          caption,
        );
      } catch (error) {
        throw error;
      }
    } else {
      return "Número inválido";
    }
  }

  /* Converte o número para JiD */
  private converteNumero(phone: string) {
    return `${phone?.replace(/\D/g, "")}@c.us`;
  }
}
