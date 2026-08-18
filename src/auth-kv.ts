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
    saveCreds: () => write(creds, "creds"),
  };
}
