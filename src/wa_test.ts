import {
  assertEquals,
  assertNotEquals,
  assertStringIncludes,
} from "@std/assert";
import type { AuthenticationCreds } from "baileys";
import { sessaoRegistrada, useKvAuthState } from "./auth-kv.ts";
import {
  caminhoSeguro,
  decodificaImagem,
  estado,
  normalizarTelefone,
  resolverSpintax,
  soDigitos,
  tempoDigitandoMs,
  tipoDoArquivo,
} from "./wa.ts";

Deno.test("soDigitos limpa a máscara do telefone", () => {
  assertEquals(soDigitos("+55 (62) 98557-8421"), "5562985578421");
  assertEquals(soDigitos(""), "");
});

Deno.test("normalizarTelefone adiciona DDI 55 quando ausente", () => {
  assertEquals(normalizarTelefone("62998510258"), "5562998510258");
  assertEquals(normalizarTelefone("6236375029"), "556236375029");
  assertEquals(normalizarTelefone("(62) 99851-0258"), "5562998510258");
  assertEquals(normalizarTelefone("5562985578421"), "5562985578421");
  assertEquals(normalizarTelefone("+55 (62) 98557-8421"), "5562985578421");
  assertEquals(normalizarTelefone("+1 555 234 5678"), "15552345678");
  assertEquals(normalizarTelefone(""), "");
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

Deno.test("sessaoRegistrada valida registered ou presenca de account e me", () => {
  // Provisório durante pareamento (não registrado)
  assertEquals(
    sessaoRegistrada({
      registered: false,
      me: { id: "556299999999@s.whatsapp.net" },
    } as unknown as AuthenticationCreds),
    false,
  );
  // Pareamento concluído com account e me
  assertEquals(
    sessaoRegistrada({
      registered: false,
      me: { id: "556299999999@s.whatsapp.net" },
      account: {},
    } as unknown as AuthenticationCreds),
    true,
  );
  // Totalmente registrado
  assertEquals(
    sessaoRegistrada({
      registered: true,
    } as unknown as AuthenticationCreds),
    true,
  );
});

Deno.test("resolverSpintax sorteia opções entre chaves", () => {
  const opcoes = ["Olá", "Oi", "E aí"];
  const res = resolverSpintax("{Olá|Oi|E aí}, mundo!");
  const prefixo = res.replace(", mundo!", "");
  assertEquals(opcoes.includes(prefixo), true);
  assertEquals(
    resolverSpintax("Texto fixo sem chaves"),
    "Texto fixo sem chaves",
  );
});

Deno.test("tempoDigitandoMs retorna 0 em ambiente de teste", () => {
  assertEquals(tempoDigitandoMs("Olá mundo curto"), 0);
});
