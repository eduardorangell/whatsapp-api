// Gerenciamento e persistência da base de leads no Deno KV.

export type StatusLead = "valido" | "enviado" | "sem_whatsapp" | "falha";

export interface Lead {
  phone: string;
  jid?: string;
  status: StatusLead;
  origem: string;
  primeiroContatoEm: string;
  ultimoContatoEm: string;
  totalEnvios: number;
  ultimaMensagemId?: string;
  ultimoErro?: string;
}

export interface AtualizacaoLead {
  phone: string;
  jid?: string;
  status: StatusLead;
  origem: string;
  mensagemId?: string;
  erro?: string;
}

export async function salvarOuAtualizarLead(
  kv: Deno.Kv,
  dados: AtualizacaoLead,
): Promise<Lead> {
  const chave = ["leads", dados.phone];
  const agora = new Date().toISOString();
  const existente = (await kv.get<Lead>(chave)).value;

  const primeiroContatoEm = existente?.primeiroContatoEm ?? agora;
  const totalEnvios = (existente?.totalEnvios ?? 0) +
    (dados.status === "enviado" ? 1 : 0);

  const lead: Lead = {
    phone: dados.phone,
    jid: dados.jid ?? existente?.jid,
    status: dados.status,
    origem: dados.origem,
    primeiroContatoEm,
    ultimoContatoEm: agora,
    totalEnvios,
    ultimaMensagemId: dados.mensagemId ?? existente?.ultimaMensagemId,
    ultimoErro: dados.erro,
  };

  await kv.set(chave, lead);
  return lead;
}

export async function obterLead(
  kv: Deno.Kv,
  phone: string,
): Promise<Lead | null> {
  const res = await kv.get<Lead>(["leads", phone]);
  return res.value;
}

export async function listarLeads(
  kv: Deno.Kv,
  filtro?: { status?: StatusLead; limite?: number },
): Promise<Lead[]> {
  const iter = kv.list<Lead>({ prefix: ["leads"] });
  const resultado: Lead[] = [];
  const limite = filtro?.limite ?? 1000;

  for await (const entry of iter) {
    if (!entry.value) continue;
    if (filtro?.status && entry.value.status !== filtro.status) continue;
    resultado.push(entry.value);
    if (resultado.length >= limite) break;
  }

  return resultado;
}

export async function resumoLeads(kv: Deno.Kv) {
  const iter = kv.list<Lead>({ prefix: ["leads"] });
  const porStatus: Record<StatusLead, number> = {
    valido: 0,
    enviado: 0,
    sem_whatsapp: 0,
    falha: 0,
  };
  let total = 0;

  for await (const entry of iter) {
    if (!entry.value) continue;
    total++;
    const s = entry.value.status;
    if (s in porStatus) {
      porStatus[s]++;
    }
  }

  return { total, porStatus };
}

export function devePularPorCooldown(
  lead: Lead | null,
  diasCooldown?: number,
): boolean {
  if (!diasCooldown || diasCooldown <= 0 || !lead || lead.totalEnvios === 0) {
    return false;
  }
  const ultimo = new Date(lead.ultimoContatoEm).getTime();
  if (isNaN(ultimo)) return false;
  const msLimite = diasCooldown * 24 * 60 * 60 * 1000;
  return Date.now() - ultimo < msLimite;
}
