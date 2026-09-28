// Auth state in Deno KV instead of the filesystem.
// Proves Baileys needs no writable disk — the usual blocker on serverless hosts.
import {
  type AuthenticationCreds,
  type AuthenticationState,
  BufferJSON,
  initAuthCreds,
  proto,
  type SignalDataSet,
  type SignalDataTypeMap,
} from "baileys";

export function sessaoRegistrada(creds: AuthenticationCreds): boolean {
  return creds.registered === true || Boolean(creds.account && creds.me);
}

export async function useKvAuthState(
  kv: Deno.Kv,
  session: string,
): Promise<{ state: AuthenticationState; saveCreds: () => Promise<unknown> }> {
  const key = (...parts: string[]) => ["wa", session, ...parts];

  const read = async <T>(...parts: string[]): Promise<T | null> => {
    const { value } = await kv.get<string>(key(...parts));
    return value ? JSON.parse(value, BufferJSON.reviver) as T : null;
  };

  const write = (value: unknown, ...parts: string[]) =>
    kv.set(key(...parts), JSON.stringify(value, BufferJSON.replacer));

  const salvas = await read<AuthenticationCreds>("creds");
  const creds = salvas ?? initAuthCreds();

  // Se a sessão ainda não concluiu o pareamento, remove o `me` provisório
  // criado por requestPairingCode para não quebrar a reconexão.
  if (!sessaoRegistrada(creds) && creds.me) {
    delete creds.me;
  }

  // Baileys só emite "creds.update" quando o pareamento avança. Sem gravar
  // agora, um restart antes da leitura do QR geraria outra identidade e
  // invalidaria o QR que já está na tela.
  if (!salvas) await write(creds, "creds");

  return {
    state: {
      creds,
      keys: {
        get: async <T extends keyof SignalDataTypeMap>(
          type: T,
          ids: string[],
        ) => {
          const data: { [id: string]: SignalDataTypeMap[T] } = {};
          await Promise.all(ids.map(async (id) => {
            const value = await read<SignalDataTypeMap[T]>("keys", type, id);
            if (!value) return;
            data[id] = type === "app-state-sync-key"
              ? proto.Message.AppStateSyncKeyData.fromObject(
                value as Record<string, unknown>,
              ) as unknown as SignalDataTypeMap[T]
              : value;
          }));
          return data;
        },
        set: async (data: SignalDataSet) => {
          const ops: Promise<unknown>[] = [];
          for (const type of Object.keys(data) as (keyof SignalDataSet)[]) {
            for (const [id, value] of Object.entries(data[type]!)) {
              ops.push(
                value
                  ? write(value, "keys", type, id)
                  : kv.delete(key("keys", type, id)),
              );
            }
          }
          await Promise.all(ops);
        },
      },
    },
    saveCreds: () => {
      // Não persiste o `me` provisório antes do pareamento ser concluído
      if (!sessaoRegistrada(creds) && creds.me) {
        const clone = { ...creds };
        delete clone.me;
        return write(clone, "creds");
      }
      return write(creds, "creds");
    },
  };
}

/** Verifica se já existe uma sessão previamente autenticada no KV. */
export async function temSessaoValida(
  kv: Deno.Kv,
  session: string,
): Promise<boolean> {
  const { value } = await kv.get<string>(["wa", session, "creds"]);
  if (!value) return false;
  try {
    const creds = JSON.parse(value) as AuthenticationCreds;
    return sessaoRegistrada(creds);
  } catch {
    return false;
  }
}

/** Remove todos os registros (creds e chaves criptográficas) de uma sessão no KV. */
export async function limparSessao(
  kv: Deno.Kv,
  session: string,
): Promise<void> {
  for await (const entry of kv.list({ prefix: ["wa", session] })) {
    await kv.delete(entry.key);
  }
}
