import { Hono } from "@hono";
import { logger } from "@hono/logger";
import { cors } from "@hono/cors";
import { prettyJSON } from "@hono/pretty-json";
import { compress } from "@hono/compress";
import { timing } from "@hono/timing";
import { validator } from "@hono/validator";
import { z } from "zod/v4";
import { bold, cyan, yellow } from "@std/fmt/colors";
import { dirname as _dirname, fromFileUrl as _fromFileUrl } from "@std/path";

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

// Inicia instância do whatsapp
app.post(
  "/iniciar",
  validator("json", (value, c) => {
    const schema = z.object({
      phone: z.string().min(10).max(16).optional(),
    });
    const parsed = schema.safeParse(value);
    if (!parsed.success) {
      return c.json({
        error: parsed.error,
      }, 400);
    }
    return parsed.data;
  }),
  async (c) => {
    const body = c.req.valid("json");
    const result = await wppservice.initWhatsapp(body.phone);
    return c.json({ status: result });
  },
);

// Finaliza instância do whatsapp
app.post("/fechar", async (c) => {
  const result = await wppservice.closeWhatsapp();
  return c.json({ finalizado: result });
});

// Checa status do serviço Whatsapp
app.get("/status", async (c) => {
  const status = await wppservice.getStatus();
  return c.json(status);
});

// Valida número
app.post(
  "/numero-valido",
  validator("json", (value, c) => {
    const schema = z.object({
      phone: z.string().min(10).max(16),
    });
    const parsed = schema.safeParse(value);
    if (!parsed.success) {
      return c.json({
        error: parsed.error,
      }, 400);
    }
    return parsed.data;
  }),
  async (c) => {
    const body = c.req.valid("json");
    const resultado = await wppservice.validNumber(body.phone);
    return c.json(resultado);
  },
);

// Envia mensagem
app.post(
  "/enviar-mensagem",
  validator("json", (value, c) => {
    const schema = z.object({
      phone: z.string().min(10).max(16), //+55 62 985816374
      texto: z.string().min(1).max(10000),
    });
    const parsed = schema.safeParse(value);

    if (!parsed.success) {
      return c.json({
        error: parsed.error,
      }, 400);
    }
    return parsed.data;
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
    const schema = z.object({
      phone: z.string().min(10).max(16),
      imagem: z.string().min(1),
      legenda: z.string().min(1).max(1000),
    });

    const parsed = schema.safeParse(value);

    if (!parsed.success) {
      return c.json({
        error: parsed.error,
      }, 400);
    }

    return parsed.data;
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

// Envia arquivo
app.post(
  "/enviar-arquivo",
  validator("json", (value, c) => {
    const schema = z.object({
      phone: z.string().min(10).max(16),
      arquivo: z.string().min(1),
    });

    const parsed = schema.safeParse(value);

    if (!parsed.success) {
      return c.json({
        error: parsed.error,
      }, 400);
    }

    return parsed.data;
  }),
  async (c) => {
    const body = c.req.valid("json");

    try {
      // Verifica se o arquivo existe antes de tentar enviar
      const filePath = `./arquivos/${body.arquivo}`;
      await Deno.stat(filePath);

      const resultado = await wppservice.sendFile(
        body.phone,
        body.arquivo,
      );

      return c.json(resultado);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        return c.json({
          error: "Arquivo não encontrado",
          arquivo: body.arquivo,
        }, 404);
      }

      return c.json({
        error: "Erro ao enviar arquivo",
        details: error instanceof Error ? error.message : String(error),
      }, 500);
    }
  },
);

Deno.serve(
  {
    onListen(localAddr) {
      console.log(
        `${bold(yellow("Servidor rodando em:"))} ${
          cyan(`http://${localAddr.hostname}:${localAddr.port}`)
        }`,
      );
    },
    port: env().PORT,
  },
  app.fetch,
);
