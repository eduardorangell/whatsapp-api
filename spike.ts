// Feasibility spike: Baileys on pure Deno, no Node.js and no Chrome.
// Run: deno task spike   (scan the QR with WhatsApp > Linked devices)
import makeWASocket, { Browsers, DisconnectReason } from "baileys";
import qrcode from "qrcode-terminal";
import { useKvAuthState } from "./auth-kv.ts";

// Baileys expects a pino-shaped logger; this silences it without pulling pino config in.
type Logger = NonNullable<Parameters<typeof makeWASocket>[0]["logger"]>;

const silentLogger = (): Logger => ({
  level: "silent",
  child: () => silentLogger(),
  trace() {},
  debug() {},
  info() {},
  warn() {},
  error() {},
});

const kv = await Deno.openKv();

async function connect() {
  const { state, saveCreds } = await useKvAuthState(kv, "suporte");

  const sock = makeWASocket({
    auth: state,
    browser: Browsers.ubuntu("Chrome"),
    logger: silentLogger(),
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", ({ connection, qr, lastDisconnect }) => {
    if (qr) qrcode.generate(qr, { small: true });
    if (connection) console.log("connection:", connection);

    if (connection === "close") {
      const code =
        (lastDisconnect?.error as { output?: { statusCode?: number } })
          ?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) {
        console.log("logged out - clear KV and re-pair");
        return;
      }
      console.log("reconnecting...");
      connect();
    }
  });

  return sock;
}

await connect();
