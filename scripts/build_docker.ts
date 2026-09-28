// Script utilitário para build das imagens Docker modulares (Baileys / WPPConnect)
// Uso:
//   deno task docker:build --baileys
//   deno task docker:build --wppconnect

const args = Deno.args;

let motor: "baileys" | "wppconnect" = "baileys";
const extraArgs: string[] = [];

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === "--baileys" || arg === "-b") {
    motor = "baileys";
  } else if (arg === "--wppconnect" || arg === "-w") {
    motor = "wppconnect";
  } else {
    extraArgs.push(arg);
  }
}

// Se não foi passada flag na CLI, verifica se há variável de ambiente
if (!args.some((a) => a.includes("baileys") || a.includes("wppconnect"))) {
  const envEngine = Deno.env.get("WA_ENGINE")?.toLowerCase();
  if (envEngine === "wppconnect") {
    motor = "wppconnect";
  }
}

const dockerfile = `Dockerfile.${motor}`;
const tagPrincipal = `whatsapp-api:${motor}`;

console.log("\n=======================================================");
console.log(`📦 Build Docker WhatsApp API`);
console.log(`🔧 Motor selecionado: ${motor.toUpperCase()}`);
console.log(`📄 Dockerfile:        ${dockerfile}`);
console.log(`🏷️  Tag da imagem:    ${tagPrincipal}`);
console.log("=======================================================\n");

const dockerCmd = [
  "build",
  "-f",
  dockerfile,
  "-t",
  tagPrincipal,
];

// Se for baileys, também marca como latest
if (motor === "baileys") {
  dockerCmd.push("-t", "whatsapp-api:latest");
}

dockerCmd.push(...extraArgs, ".");

console.log(`> docker ${dockerCmd.join(" ")}\n`);

const comando = new Deno.Command("docker", {
  args: dockerCmd,
  stdout: "inherit",
  stderr: "inherit",
});

const processo = comando.spawn();
const status = await processo.status;

if (!status.success) {
  console.error(
    `\n❌ Falha no build da imagem Docker (código ${status.code}).`,
  );
  Deno.exit(status.code);
}

console.log(`\n✅ Imagem ${tagPrincipal} gerada com sucesso!`);
