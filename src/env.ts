// Só o que ainda faz sentido sem Chrome. HEADLESS, USE_CHROME, AUTO_CLOSE e
// WHATSAPP_VERSION morreram junto com o Puppeteer.
export default () => ({
  PORT: Number(Deno.env.get("PORT") ?? 3000),
  SESSAO: Deno.env.get("SESSAO") ?? "suporte",
  // Vazio = local padrão do Deno (não exige --allow-write).
  // No Docker apontamos para um volume.
  KV_PATH: Deno.env.get("KV_PATH") || undefined,
  PASTA_ARQUIVOS: Deno.env.get("PASTA_ARQUIVOS") ?? "./arquivos",
});
