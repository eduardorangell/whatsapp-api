import { basename, extname, join } from "@std/path";
import { decodeBase64, encodeBase64 } from "@std/encoding";
import { contentType } from "@std/media-types";

/**
 * Remove qualquer caracter não numérico.
 */
export const soDigitos = (phone: string): string =>
  (phone || "").replace(/\D/g, "");

/**
 * Normaliza um número de telefone (especialmente padrão brasileiro):
 * - Remove formatações não-numéricas.
 * - Adiciona DDI 55 (Brasil) caso tenha sido informado apenas com DDD (10 ou 11 dígitos).
 * - Se começou explicitamente com "+" e outro país (ex: +1...), preserva internacional.
 */
export function normalizarTelefone(phone: string): string {
  const raw = (phone || "").trim();
  const limpo = raw.replace(/\D/g, "");
  if (!limpo) return "";

  // Já começa com DDI 55 e tem tamanho de telefone brasileiro com DDI (12 ou 13 dígitos)
  if (limpo.startsWith("55") && (limpo.length === 12 || limpo.length === 13)) {
    return limpo;
  }

  // Se começou explicitamente com "+" e outro país (ex: +1...), preserva internacional
  if (raw.startsWith("+") && !raw.startsWith("+55")) {
    return limpo;
  }

  // Se tem 10 dígitos (DDD + 8 dígitos) ou 11 dígitos (DDD + 9 dígitos), insere DDI 55
  if (limpo.length === 10 || limpo.length === 11) {
    return `55${limpo}`;
  }

  return limpo;
}

/**
 * Resolve variações Spintax em um texto.
 * Exemplo: "{Olá|Oi|E aí}, tudo bem?" -> sorteia uma das opções entre chaves.
 */
export function resolverSpintax(texto: string): string {
  return texto.replace(/\{([^{}]+)\}/g, (_, opcoes) => {
    const itens = opcoes.split("|");
    return itens[Math.floor(Math.random() * itens.length)].trim();
  });
}

/**
 * Calcula tempo realista de digitação humana baseado no tamanho do texto.
 * ~25 caracteres/segundo, piso de 1.5s e teto de 10s + variação aleatória.
 * Em ambiente de teste (DENO_ENV=test), retorna 0.
 */
export function tempoDigitandoMs(texto: string): number {
  if (Deno.env.get("DENO_ENV") === "test") return 0;
  const chars = texto.trim().length;
  const baseSegundos = Math.min(10, Math.max(1.5, chars / 25));
  const variacao = Math.random() * 0.8;
  return Math.floor((baseSegundos + variacao) * 1000);
}

/**
 * basename() corta "../" — o cliente não escolhe diretório, só o arquivo.
 */
export const caminhoSeguro = (pasta: string, arquivo: string): string =>
  join(pasta, basename(arquivo));

/**
 * Retorna o MIME type baseado na extensão do arquivo.
 */
export const tipoDoArquivo = (nome: string): string =>
  contentType(extname(nome)) ?? "application/octet-stream";

/**
 * Aceita data URI ("data:image/jpeg;base64,...") ou base64 puro.
 */
export function decodificaImagem(entrada: string): Uint8Array {
  const virgula = entrada.startsWith("data:") ? entrada.indexOf(",") + 1 : 0;
  return decodeBase64(entrada.slice(virgula));
}

/**
 * Converte entrada de imagem (URL HTTP/HTTPS, arquivo local ou base64) para Data URI.
 */
export async function resolverImagemParaDataUri(
  entrada: string,
  pastaArquivos?: string,
): Promise<string> {
  if (!entrada) return "";

  // 1. Data URI já pronta
  if (entrada.startsWith("data:")) {
    return entrada;
  }

  // 2. URL HTTP ou HTTPS
  if (entrada.startsWith("http://") || entrada.startsWith("https://")) {
    const res = await fetch(entrada);
    if (!res.ok) {
      throw new Error(`Falha ao baixar imagem: HTTP ${res.status}`);
    }
    const buf = await res.arrayBuffer();
    const mime = res.headers.get("content-type") || "image/jpeg";
    return `data:${mime};base64,${encodeBase64(new Uint8Array(buf))}`;
  }

  // 3. Arquivo local no disco
  if (pastaArquivos) {
    try {
      const caminho = caminhoSeguro(pastaArquivos, entrada);
      const bytes = await Deno.readFile(caminho);
      const mime = tipoDoArquivo(caminho);
      return `data:${mime};base64,${encodeBase64(bytes)}`;
    } catch {
      // Prossegue
    }
  }

  try {
    const bytes = await Deno.readFile(entrada);
    const mime = tipoDoArquivo(entrada);
    return `data:${mime};base64,${encodeBase64(bytes)}`;
  } catch {
    // Trata como base64 puro
  }

  return `data:image/jpeg;base64,${entrada}`;
}

/**
 * Delay assíncrono simples.
 */
export const delayMs = (ms: number): Promise<void> =>
  ms > 0
    ? new Promise((resolve) => setTimeout(resolve, ms))
    : Promise.resolve();

/**
 * Intervalo de espera aleatório (anti-banimento).
 */
export const tempoDeEsperaAleatorio = (min = 30, max = 45): number =>
  Deno.env.get("DENO_ENV") === "test"
    ? 0
    : (Math.floor(Math.random() * (max - min + 1)) + min) * 1000;
