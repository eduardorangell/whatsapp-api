import { Logger } from "@deno-library/logger";
export const logger = new Logger();

const env = Deno.env.toObject();
export default () => ({
  PORT: parseInt(env.PORT || "3000"),
  WAIT_FOR_LOGIN: env.WAIT_FOR_LOGIN === "true" ? true : false,
  HEADLESS: env.HEADLESS === "false" ? false : true,
  USE_CHROME: env.USE_CHROME === "true" ? true : false,
  AUTO_CLOSE: parseInt(env.AUTO_CLOSE || "90000"),
  WHATSAPP_VERSION: env.WHATSAPP_VERSION,
  LOG_QR: env.LOG_QR === "true" ? true : false,
});
