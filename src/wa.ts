// Adaptador unificado para motores WhatsApp (Baileys / WPPConnect)
import { obterEngine } from "./engines/factory.ts";
import type { EngineType, WhatsAppEngine } from "./engines/types.ts";
import {
  devePularPorCooldown,
  obterLead,
  salvarOuAtualizarLead,
} from "./leads.ts";
import { contadores, log } from "./obs.ts";
import {
  caminhoSeguro,
  decodificaImagem,
  delayMs,
  normalizarTelefone,
  resolverSpintax,
  soDigitos,
  tempoDeEsperaAleatorio,
  tempoDigitandoMs,
  tipoDoArquivo,
} from "./util.ts";

export {
  caminhoSeguro,
  decodificaImagem,
  delayMs,
  normalizarTelefone,
  resolverSpintax,
  soDigitos,
  tempoDeEsperaAleatorio,
  tempoDigitandoMs,
  tipoDoArquivo,
};

let kvGlobal: Deno.Kv | null = null;
let sessaoGlobal: string = "default";
let pastaArquivosGlobal: string = "./arquivos";

let estadoAtual = {
  motor: "baileys" as EngineType,
  online: false,
  sessaoIniciada: false,
  usuario: null as { id: string } | null,
  qrPendente: false,
  ultimaDesconexao: null as
    | { quando: string; motivo: string; codigo?: number }
    | null,
  detalhes: undefined as Record<string, unknown> | undefined,
};

export function configurarWa(
  kv: Deno.Kv,
  sessao: string,
  pastaArquivos = "./arquivos",
) {
  kvGlobal = kv;
  sessaoGlobal = sessao;
  pastaArquivosGlobal = pastaArquivos;
}

export function obterKv(): Deno.Kv | null {
  return kvGlobal;
}

export function estado() {
  return estadoAtual;
}

export async function sincronizarEstado() {
  const engine = await obterEngine({
    kv: kvGlobal ?? undefined,
    sessao: sessaoGlobal,
    pastaArquivos: pastaArquivosGlobal,
  });
  const est = await engine.obterEstado();
  estadoAtual = {
    motor: est.motor,
    online: est.conectado,
    sessaoIniciada: est.conectado || (est.detalhes?.sessaoIniciada === true),
    usuario: (est.detalhes?.usuario as { id: string } | null) ??
      (est.telefone ? { id: est.telefone } : null),
    qrPendente: est.detalhes?.qrPendente === true,
    ultimaDesconexao: (est.detalhes?.ultimaDesconexao as {
      quando: string;
      motivo: string;
      codigo?: number;
    } | null) ?? null,
    detalhes: est.detalhes,
  };
  return estadoAtual;
}

export async function iniciar(phone?: string) {
  const engine = await obterEngine({
    kv: kvGlobal ?? undefined,
    sessao: sessaoGlobal,
    pastaArquivos: pastaArquivosGlobal,
  });
  const res = await engine.iniciar({ phone });
  await sincronizarEstado();
  return {
    status: res.mensagem,
    codigo: res.pairingCode,
    qr: res.qrCode,
  };
}

export async function desconectar(): Promise<boolean> {
  const engine = await obterEngine({
    kv: kvGlobal ?? undefined,
    sessao: sessaoGlobal,
    pastaArquivos: pastaArquivosGlobal,
  });
  const ok = await engine.fechar();
  await sincronizarEstado();
  return ok;
}

export async function logout(): Promise<boolean> {
  const engine = await obterEngine({
    kv: kvGlobal ?? undefined,
    sessao: sessaoGlobal,
    pastaArquivos: pastaArquivosGlobal,
  });
  const ok = await engine.logout();
  await sincronizarEstado();
  return ok;
}

export async function numeroValido(phone: string): Promise<string | null> {
  const engine = await obterEngine({
    kv: kvGlobal ?? undefined,
    sessao: sessaoGlobal,
    pastaArquivos: pastaArquivosGlobal,
  });
  const res = await engine.validarNumero(phone);
  return res.existe && res.jid ? res.jid : null;
}

export async function enviarTexto(
  phone: string,
  texto: string,
  origem = "enviar-mensagem",
): Promise<{ jid: string; id?: string } | null> {
  const engine = await obterEngine({
    kv: kvGlobal ?? undefined,
    sessao: sessaoGlobal,
    pastaArquivos: pastaArquivosGlobal,
  });
  const res = await engine.enviarTexto(phone, texto, origem);
  if (!res.sucesso) return null;
  return { jid: res.destinatario, id: res.id };
}

export async function enviarImagem(
  phone: string,
  imagem: string,
  legenda = "",
  _pasta?: string,
  origem = "enviar-imagem",
): Promise<{ jid: string; id?: string } | null> {
  const engine = await obterEngine({
    kv: kvGlobal ?? undefined,
    sessao: sessaoGlobal,
    pastaArquivos: pastaArquivosGlobal,
  });
  const res = await engine.enviarImagem(phone, imagem, legenda, origem);
  if (!res.sucesso) return null;
  return { jid: res.destinatario, id: res.id };
}

export async function enviarArquivo(
  phone: string,
  _pasta: string,
  arquivo: string,
  origem = "enviar-arquivo",
): Promise<{ jid: string; id?: string } | null> {
  const engine = await obterEngine({
    kv: kvGlobal ?? undefined,
    sessao: sessaoGlobal,
    pastaArquivos: pastaArquivosGlobal,
  });
  const res = await engine.enviarArquivo(phone, arquivo, undefined, origem);
  if (!res.sucesso) return null;
  return { jid: res.destinatario, id: res.id };
}

/** Envio em lote assíncrono com delay anti-banimento (30-45s) e suporte a cooldown. */
export async function enviarTudo(
  numeros: string[],
  texto: string,
  pastaArquivos: string,
  imagem?: string,
  diasCooldown?: number,
  engineInstancia?: WhatsAppEngine,
) {
  const engine = engineInstancia || await obterEngine({
    kv: kvGlobal ?? undefined,
    sessao: sessaoGlobal,
    pastaArquivos: pastaArquivos || pastaArquivosGlobal,
  });

  const kv = kvGlobal ?? engine.obterKv?.() ?? null;

  log("info", "lote_iniciado", {
    motor: engine.tipo,
    total: numeros.length,
    temImagem: !!imagem,
    diasCooldown: diasCooldown ?? null,
  });

  for (const [idx, num] of numeros.entries()) {
    const tel = normalizarTelefone(num);

    // Verificação de Cooldown (deduplicação anti-spam)
    if (kv && diasCooldown && diasCooldown > 0) {
      const lead = await obterLead(kv, tel);
      if (devePularPorCooldown(lead, diasCooldown)) {
        log("info", "lote_pulado_cooldown", {
          motor: engine.tipo,
          numero: tel,
          indice: idx + 1,
          total: numeros.length,
          diasCooldown,
          ultimoContatoEm: lead?.ultimoContatoEm,
        });
        continue;
      }
    }

    let enviado = false;
    try {
      const res = imagem
        ? await engine.enviarImagem(tel, imagem, texto, "enviar-tudo")
        : await engine.enviarTexto(tel, texto, "enviar-tudo");

      if (!res.sucesso) {
        contadores.falhasDeEnvio++;
        log("aviso", "numero_sem_whatsapp", {
          motor: engine.tipo,
          numero: tel,
          indice: idx + 1,
          total: numeros.length,
        });
      } else {
        enviado = true;
      }
    } catch (e) {
      contadores.falhasDeEnvio++;
      if (kv) {
        await salvarOuAtualizarLead(kv, {
          phone: tel,
          status: "falha",
          origem: "enviar-tudo",
          erro: e instanceof Error ? e.message : String(e),
        });
      }
      log("erro", "falha_lote", {
        motor: engine.tipo,
        numero: tel,
        indice: idx + 1,
        erro: e instanceof Error ? e.message : String(e),
      });
    }

    if (idx < numeros.length - 1) {
      // Se enviado com sucesso, cumpre intervalo de segurança anti-ban (30-45s).
      // Se o número não tem WhatsApp ou deu erro, pausa curta (2-5s) para não travar a fila.
      const espera = enviado
        ? tempoDeEsperaAleatorio(30, 45)
        : tempoDeEsperaAleatorio(2, 5);
      log("info", "lote_aguardando", {
        segundos: espera / 1000,
        proximo: idx + 2,
        total: numeros.length,
        motivo: enviado ? "intervalo_seguranca" : "numero_ignorado",
      });
      await delayMs(espera);
    }
  }

  log("info", "lote_finalizado", { motor: engine.tipo, total: numeros.length });
}
