import { assertEquals } from "@std/assert";
import {
  devePularPorCooldown,
  type Lead,
  listarLeads,
  obterLead,
  resumoLeads,
  salvarOuAtualizarLead,
} from "./leads.ts";

Deno.test("leads: ciclo de vida completo no KV", async () => {
  const kv = await Deno.openKv(":memory:");

  try {
    // 1. Inserir lead inicial via numero-valido
    const l1 = await salvarOuAtualizarLead(kv, {
      phone: "5562998510258",
      jid: "556298510258@s.whatsapp.net",
      status: "valido",
      origem: "numero-valido",
    });

    assertEquals(l1.status, "valido");
    assertEquals(l1.totalEnvios, 0);
    assertEquals(l1.phone, "5562998510258");

    // 2. Atualizar para enviado via enviar-mensagem
    const l2 = await salvarOuAtualizarLead(kv, {
      phone: "5562998510258",
      status: "enviado",
      origem: "enviar-mensagem",
      mensagemId: "MSG123",
    });

    assertEquals(l2.status, "enviado");
    assertEquals(l2.totalEnvios, 1);
    assertEquals(l2.primeiroContatoEm, l1.primeiroContatoEm);
    assertEquals(l2.ultimaMensagemId, "MSG123");
    assertEquals(l2.jid, "556298510258@s.whatsapp.net");

    // 3. Inserir outro lead sem_whatsapp
    await salvarOuAtualizarLead(kv, {
      phone: "556236375029",
      status: "sem_whatsapp",
      origem: "numero-valido",
    });

    // 4. Buscar lead individual
    const buscado = await obterLead(kv, "5562998510258");
    assertEquals(buscado?.totalEnvios, 1);

    const inexistente = await obterLead(kv, "000");
    assertEquals(inexistente, null);

    // 5. Listar e filtrar
    const todos = await listarLeads(kv);
    assertEquals(todos.length, 2);

    const enviados = await listarLeads(kv, { status: "enviado" });
    assertEquals(enviados.length, 1);
    assertEquals(enviados[0].phone, "5562998510258");

    const semWhats = await listarLeads(kv, { status: "sem_whatsapp" });
    assertEquals(semWhats.length, 1);
    assertEquals(semWhats[0].phone, "556236375029");

    // 6. Resumo consolidado
    const r = await resumoLeads(kv);
    assertEquals(r.total, 2);
    assertEquals(r.porStatus.enviado, 1);
    assertEquals(r.porStatus.sem_whatsapp, 1);
    assertEquals(r.porStatus.valido, 0);
  } finally {
    kv.close();
  }
});

Deno.test("leads: devePularPorCooldown respeita intervalo de dias", () => {
  const agora = Date.now();
  const doisDiasAtras = new Date(agora - 2 * 24 * 60 * 60 * 1000).toISOString();
  const vinteDiasAtras = new Date(agora - 20 * 24 * 60 * 60 * 1000)
    .toISOString();

  const leadRecente: Lead = {
    phone: "5562998510258",
    status: "enviado",
    origem: "enviar-tudo",
    primeiroContatoEm: doisDiasAtras,
    ultimoContatoEm: doisDiasAtras,
    totalEnvios: 1,
  };

  const leadAntigo: Lead = {
    phone: "5562998510258",
    status: "enviado",
    origem: "enviar-tudo",
    primeiroContatoEm: vinteDiasAtras,
    ultimoContatoEm: vinteDiasAtras,
    totalEnvios: 1,
  };

  const leadSemEnvio: Lead = {
    phone: "5562998510258",
    status: "valido",
    origem: "numero-valido",
    primeiroContatoEm: doisDiasAtras,
    ultimoContatoEm: doisDiasAtras,
    totalEnvios: 0,
  };

  // Cooldown de 7 dias
  assertEquals(devePularPorCooldown(leadRecente, 7), true); // enviou há 2 dias -> pula
  assertEquals(devePularPorCooldown(leadAntigo, 7), false); // enviou há 20 dias -> não pula
  assertEquals(devePularPorCooldown(leadSemEnvio, 7), false); // nunca enviou -> não pula
  assertEquals(devePularPorCooldown(null, 7), false); // lead novo -> não pula
  assertEquals(devePularPorCooldown(leadRecente, 0), false); // sem cooldown -> não pula
});
