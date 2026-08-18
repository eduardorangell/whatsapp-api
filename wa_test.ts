import { assertEquals } from "@std/assert";
import { decodificaImagem, soDigitos } from "./wa.ts";

Deno.test("soDigitos limpa máscara do telefone", () => {
  assertEquals(soDigitos("+55 (62) 98557-8421"), "5562985578421");
});

Deno.test("decodificaImagem aceita data URI e base64 puro", () => {
  const esperado = new Uint8Array([104, 105]); // "hi"
  assertEquals(decodificaImagem("data:image/jpeg;base64,aGk="), esperado);
  assertEquals(decodificaImagem("aGk="), esperado);
});

import { rota } from "./server.ts";

const post = (caminho: string, corpo: unknown) =>
  rota(
    new Request(`http://localhost${caminho}`, {
      method: "POST",
      body: typeof corpo === "string" ? corpo : JSON.stringify(corpo),
    }),
  );

Deno.test("valida rota, payload e telefone sem precisar de conexão", async () => {
  assertEquals((await post("/nada", {})).status, 404);
  assertEquals((await post("/enviar-mensagem", "xx")).status, 400);
  assertEquals((await post("/enviar-mensagem", { phone: "123" })).status, 400);
  assertEquals(
    (await post("/enviar-mensagem", { phone: "5562985578421" })).status,
    400,
  );
  // payload válido + desconectado => 503
  const r = await post("/enviar-mensagem", {
    phone: "+55 (62) 98557-8421",
    texto: "oi",
  });
  assertEquals(r.status, 503);
});
