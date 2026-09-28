// Factory para criação e obtenção dinâmica do motor WhatsApp ativo
import type { WhatsAppEngine } from "./types.ts";
import { log } from "../obs.ts";

let engineAtivo: WhatsAppEngine | null = null;

export async function obterEngine(opcoes?: {
  tipo?: "baileys" | "wppconnect";
  kv?: Deno.Kv;
  sessao?: string;
  pastaArquivos?: string;
}): Promise<WhatsAppEngine> {
  const tipoEscolhido = opcoes?.tipo ||
    Deno.env.get("WA_ENGINE")?.toLowerCase() || "baileys";

  // Se já existe uma instância do mesmo tipo, reutiliza
  if (engineAtivo && engineAtivo.tipo === tipoEscolhido) {
    if (opcoes?.kv && "configurarKv" in engineAtivo) {
      // deno-lint-ignore no-explicit-any
      (engineAtivo as any).configurarKv(
        opcoes.kv,
        opcoes.sessao || "default",
        opcoes.pastaArquivos,
      );
    }
    return engineAtivo;
  }

  // Se havia outro tipo ativo, fecha
  if (engineAtivo && engineAtivo.tipo !== tipoEscolhido) {
    log("info", "troca_de_motor", {
      anterior: engineAtivo.tipo,
      novo: tipoEscolhido,
    });
    try {
      await engineAtivo.fechar();
    } catch {
      // Ignora erro ao fechar motor anterior
    }
    engineAtivo = null;
  }

  log("info", "inicializando_motor", { motor: tipoEscolhido });

  if (tipoEscolhido === "wppconnect") {
    const { WppConnectEngine } = await import("./wppconnect.ts");
    engineAtivo = new WppConnectEngine(
      opcoes?.kv,
      opcoes?.sessao || "suporte",
      opcoes?.pastaArquivos || "./arquivos",
    );
  } else {
    const { BaileysEngine } = await import("./baileys.ts");
    engineAtivo = new BaileysEngine(
      opcoes?.kv,
      opcoes?.sessao || "default",
      opcoes?.pastaArquivos || "./arquivos",
    );
  }

  return engineAtivo;
}

export function resetEngine(): void {
  engineAtivo = null;
}
