// Rotas testadas sem parear celular: validação roda antes da conexão.
import { assertEquals } from "@std/assert";
import { rota } from "./server.ts";

const chamar = (metodo: string, caminho: string, corpo?: unknown) =>
  rota(
    new Request(`http://localhost${caminho}`, {
      method: metodo,
      body: corpo === undefined
        ? undefined
        : typeof corpo === "string"
        ? corpo
        : JSON.stringify(corpo),
    }),
  );

const post = (caminho: string, corpo?: unknown) =>
  chamar("POST", caminho, corpo);

async function statusEErro(res: Response) {
  return { status: res.status, erro: (await res.json()).erro };
}

Deno.test("GET / responde Olá", async () => {
  const res = await chamar("GET", "/");
  assertEquals(res.status, 200);
  assertEquals((await res.json()).mensagem, "Olá");
});

Deno.test("GET /status responde sem conexão", async () => {
  const res = await chamar("GET", "/status");
  assertEquals(res.status, 200);
  assertEquals((await res.json()).online, false);
});

Deno.test("rota inexistente e método errado dão 404", async () => {
  assertEquals((await post("/nada")).status, 404);
  assertEquals((await chamar("GET", "/enviar-mensagem")).status, 404);
  assertEquals((await chamar("DELETE", "/status")).status, 404);
});

Deno.test("json malformado dá 400", async () => {
  assertEquals(
    await statusEErro(await post("/enviar-mensagem", "{ nao é json")),
    { status: 400, erro: "json inválido" },
  );
});

Deno.test("telefone inválido dá 400 em toda rota que exige phone", async () => {
  for (
    const caminho of [
      "/numero-valido",
      "/enviar-mensagem",
      "/enviar-imagem",
      "/enviar-arquivo",
    ]
  ) {
    assertEquals(await statusEErro(await post(caminho, { phone: "123" })), {
      status: 400,
      erro: "phone inválido",
    }, caminho);
  }
});

Deno.test("campo obrigatório faltando dá 400", async () => {
  const phone = "5562985578421";
  assertEquals(await statusEErro(await post("/enviar-mensagem", { phone })), {
    status: 400,
    erro: "texto obrigatório",
  });
  assertEquals(await statusEErro(await post("/enviar-imagem", { phone })), {
    status: 400,
    erro: "imagem obrigatória",
  });
  assertEquals(await statusEErro(await post("/enviar-arquivo", { phone })), {
    status: 400,
    erro: "arquivo obrigatório",
  });
});

Deno.test("payload válido sem conexão dá 503", async () => {
  const phone = "+55 (62) 98557-8421";
  assertEquals(
    await statusEErro(await post("/enviar-mensagem", { phone, texto: "oi" })),
    {
      status: 503,
      erro: "whatsapp desconectado",
    },
  );
  assertEquals(await statusEErro(await post("/numero-valido", { phone })), {
    status: 503,
    erro: "whatsapp desconectado",
  });
});

Deno.test("/iniciar, /fechar e /logout respondem sem corpo", async () => {
  assertEquals((await post("/iniciar")).status, 200);
  const fechar = await post("/fechar");
  assertEquals(fechar.status, 200);
  assertEquals((await fechar.json()).finalizado, false);
  const logout = await post("/logout");
  assertEquals(logout.status, 200);
  assertEquals((await logout.json()).deslogado, true);
});

Deno.test("/iniciar valida phone quando informado", async () => {
  assertEquals(await statusEErro(await post("/iniciar", { phone: "1" })), {
    status: 400,
    erro: "phone inválido",
  });
});

Deno.test("POST /enviar-tudo valida numeros e texto", async () => {
  assertEquals(
    await statusEErro(await post("/enviar-tudo", { texto: "oi" })),
    {
      status: 400,
      erro: "numeros deve ser um array com pelo menos 1 telefone",
    },
  );

  assertEquals(
    await statusEErro(
      await post("/enviar-tudo", { numeros: [], texto: "oi" }),
    ),
    {
      status: 400,
      erro: "numeros deve ser um array com pelo menos 1 telefone",
    },
  );

  assertEquals(
    await statusEErro(
      await post("/enviar-tudo", { numeros: ["123"], texto: "oi" }),
    ),
    {
      status: 400,
      erro: "phone inválido no lote: 123",
    },
  );

  assertEquals(
    await statusEErro(
      await post("/enviar-tudo", { numeros: ["5562985578421"] }),
    ),
    {
      status: 400,
      erro: "texto obrigatório",
    },
  );

  const res = await post("/enviar-tudo", {
    numeros: ["5562985578421", "+55 (62) 98332-8888"],
    texto: "Olá a todos",
  });
  assertEquals(res.status, 200);
  const data = await res.json();
  assertEquals(data.status, "iniciado");
  assertEquals(data.total, 2);
});
