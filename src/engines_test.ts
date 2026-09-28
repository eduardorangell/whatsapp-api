import { assertEquals, assertNotEquals } from "@std/assert";
import { obterEngine, resetEngine } from "./engines/factory.ts";

Deno.test("obterEngine devolve Baileys por padrão", async () => {
  resetEngine();
  const engine = await obterEngine();
  assertEquals(engine.tipo, "baileys");
  const estado = await engine.obterEstado();
  assertEquals(estado.motor, "baileys");
  assertEquals(estado.conectado, false);
});

Deno.test("obterEngine devolve WPPConnect quando solicitado", async () => {
  resetEngine();
  const engine = await obterEngine({ tipo: "wppconnect" });
  assertEquals(engine.tipo, "wppconnect");
  const estado = await engine.obterEstado();
  assertEquals(estado.motor, "wppconnect");
  assertEquals(estado.conectado, false);
});

Deno.test("obterEngine alterna entre motores sem conflito", async () => {
  resetEngine();
  const b = await obterEngine({ tipo: "baileys" });
  assertEquals(b.tipo, "baileys");

  const w = await obterEngine({ tipo: "wppconnect" });
  assertEquals(w.tipo, "wppconnect");
  assertNotEquals(b.tipo, w.tipo);

  // Voltar para Baileys
  const b2 = await obterEngine({ tipo: "baileys" });
  assertEquals(b2.tipo, "baileys");
});
