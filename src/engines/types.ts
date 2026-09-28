export type EngineType = "baileys" | "wppconnect";

export interface EstadoConexao {
  motor: EngineType;
  conectado: boolean;
  autenticado: boolean;
  telefone?: string;
  detalhes?: Record<string, unknown>;
}

export interface IniciarOpcoes {
  phone?: string;
}

export interface IniciarResultado {
  sucesso: boolean;
  mensagem: string;
  qrCode?: string;
  pairingCode?: string;
}

export interface ResultadoEnvio {
  sucesso: boolean;
  id?: string;
  mensagem?: string;
  destinatario: string;
  timestamp?: string;
}

export interface WhatsAppEngine {
  readonly tipo: EngineType;
  iniciar(opcoes?: IniciarOpcoes): Promise<IniciarResultado>;
  fechar(): Promise<boolean>;
  logout(): Promise<boolean>;
  obterEstado(): Promise<EstadoConexao>;
  validarNumero(phone: string): Promise<{ existe: boolean; jid?: string }>;
  enviarTexto(
    phone: string,
    texto: string,
    origem?: string,
  ): Promise<ResultadoEnvio>;
  enviarImagem(
    phone: string,
    imagem: string,
    legenda?: string,
    origem?: string,
  ): Promise<ResultadoEnvio>;
  enviarArquivo(
    phone: string,
    arquivo: string,
    legenda?: string,
    origem?: string,
  ): Promise<ResultadoEnvio>;
  obterKv?(): Deno.Kv | null;
}
