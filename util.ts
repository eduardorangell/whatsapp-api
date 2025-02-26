import { Logger } from "@deno-library/logger";
export const logger = new Logger();

export default () => ({
  PORT: parseInt(Deno.env.get("PORT") || "3000"),
  WAIT_FOR_LOGIN: Deno.env.get("WAIT_FOR_LOGIN") === "true" ? true : false,
  HEADLESS: Deno.env.get("HEADLESS") === "false" ? false : true,
  USE_CHROME: Deno.env.get("USE_CHROME") === "true" ? true : false,
  AUTO_CLOSE: parseInt(Deno.env.get("AUTO_CLOSE") || "90000"),
});
