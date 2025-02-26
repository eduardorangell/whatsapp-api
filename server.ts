import { Hono } from "@hono";
import { logger } from "@hono/logger";
import { cors } from "@hono/cors";
import { prettyJSON } from "@hono/pretty-json";
import { compress } from "@hono/compress";
import { timing } from "@hono/timing";
import { validator } from "@hono/validator";
import { bold, cyan, yellow } from "@std/fmt/colors";

import { WhatsappService } from "./whatsapp.ts";
import env from "./util.ts";

const wppservice = new WhatsappService();

// Iniciando Hono
const app = new Hono();

// CORS
app.use(cors());

// Pretty JSON
app.use(prettyJSON());

// Compressão GZIP
app.use(compress());

// Tempo de resposta do servidor
app.use(timing());

// Rota inicial
app.get("/", (c) => {
  return c.text("Olá");
});

// Custom Logger
const customLogger = (...rest: string[]) => {
  console.log(
    `${
      bold(
        cyan(
          Intl.DateTimeFormat("pt-BR", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            fractionalSecondDigits: 3,
          }).format(new Date()),
        ),
      )
    }`,
    ...rest,
  );
};
app.use(logger(customLogger));

// Valida número
app.post(
  "/numero-valido",
  validator("json", (value, c) => {
    // deno-lint-ignore no-explicit-any
    const isExactNumeroValido = (obj: any): obj is { phone: string } =>
      Object.keys(obj).length === 1 && obj.phone?.constructor === String;

    if (!isExactNumeroValido(value)) {
      return c.text("Número inválido", 400);
    }
    return value;
  }),
  async (c) => {
    const body = c.req.valid("json");
    console.log(body);
    const resultado = await wppservice.validNumber(body.phone);
    return c.json(resultado);
  },
);

// Envia mensagem
app.post(
  "/enviar-mensagem",
  validator("json", (value, c) => {
    const isExactEnviarMensagem = (
      // deno-lint-ignore no-explicit-any
      obj: any,
    ): obj is { phone: string; texto: string } =>
      Object.keys(obj).length === 2 &&
      obj.phone?.constructor === String &&
      obj.texto?.constructor === String;

    if (!isExactEnviarMensagem(value)) {
      return c.text("Inválido", 400);
    }
    return value;
  }),
  async (c) => {
    const body = c.req.valid("json");
    const resultado = await wppservice.sendText(body.phone, body.texto);
    return c.json(resultado);
  },
);

// Envia imagem base64
app.post(
  "/enviar-imagem",
  validator("json", (value, c) => {
    const isExactEnviarImagem = (
      // deno-lint-ignore no-explicit-any
      obj: any,
    ): obj is { phone: string; imagem: string; legenda: string } =>
      Object.keys(obj).length === 3 &&
      obj.phone?.constructor === String &&
      obj.imagem?.constructor === String &&
      obj.legenda?.constructor === String;

    if (!isExactEnviarImagem(value)) {
      return c.text("Inválido", 400);
    }
    return value;
  }),
  async (c) => {
    const body = c.req.valid("json");
    const resultado = await wppservice.sendImage(
      body.phone,
      body.imagem,
      body.legenda,
    );
    return c.json(resultado);
  },
);

Deno.serve(
  {
    onListen(localAddr) {
      console.log(
        `${bold(yellow("Server is running on:"))} ${
          cyan(`http://${localAddr.hostname}:${localAddr.port}`)
        }`,
      );
    },
    port: env().PORT,
  },
  app.fetch,
);
