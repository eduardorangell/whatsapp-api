import {
  assertEquals,
  assertNotEquals,
  assertStringIncludes,
} from "@std/assert";
import { useKvAuthState } from "./auth-kv.ts";
import {
  caminhoSeguro,
  decodificaImagem,
  estado,
  soDigitos,
  tipoDoArquivo,
} from "./wa.ts";

Deno.test("soDigitos limpa a máscara do telefone", () => {
  assertEquals(soDigitos("+55 (62) 98557-8421"), "5562985578421");
  assertEquals(soDigitos(""), "");
});

Deno.test("decodificaImagem aceita data URI e base64 puro", () => {
  const esperado = new Uint8Array([104, 105]); // "hi"
  assertEquals(decodificaImagem("data:image/jpeg;base64,aGk="), esperado);
  assertEquals(decodificaImagem("aGk="), esperado);
});

Deno.test("caminhoSeguro impede subir de diretório", () => {
  assertEquals(caminhoSeguro("./arquivos", "nota.pdf"), "arquivos/nota.pdf");
  assertEquals(
    caminhoSeguro("./arquivos", "../../etc/passwd"),
    "arquivos/passwd",
  );
  assertEquals(caminhoSeguro("./arquivos", "/etc/passwd"), "arquivos/passwd");
});

Deno.test("tipoDoArquivo deduz o mimetype pela extensão", () => {
  assertStringIncludes(tipoDoArquivo("nota.pdf"), "application/pdf");
  assertStringIncludes(tipoDoArquivo("foto.jpeg"), "image/jpeg");
  assertEquals(tipoDoArquivo("sem-extensao"), "application/octet-stream");
});

Deno.test("estado começa desconectado", () => {
  assertEquals(estado().online, false);
  assertEquals(estado().sessaoIniciada, false);
});

Deno.test("useKvAuthState grava creds novas na hora", async () => {
  const kv = await Deno.openKv(":memory:");
  const { state } = await useKvAuthState(kv, "t1");

  // Persistiu sem esperar por "creds.update".
  const { state: relido } = await useKvAuthState(kv, "t1");
  assertEquals(relido.creds.registrationId, state.creds.registrationId);

  // Sessões diferentes não se misturam.
  const { state: outra } = await useKvAuthState(kv, "t2");
  assertNotEquals(outra.creds.registrationId, state.creds.registrationId);
  kv.close();
});
