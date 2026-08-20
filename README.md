# whatsapp-baileys

API HTTP para enviar mensagens, imagens e arquivos pelo WhatsApp, em **Deno
puro** — sem Node.js e sem Chrome headless.

É a reescrita do `../whatsapp-api`, que usava WPPConnect (Puppeteer dirigindo um
Chrome de verdade). Aqui o [Baileys](https://github.com/WhiskeySockets/Baileys)
fala o protocolo do WhatsApp Web direto por WebSocket. Sai o navegador inteiro,
entra um socket: **~104 MB de RAM** contra o Chrome completo, e nenhuma
dependência de sistema.

## Como funciona

```
src/env.ts       configuração por variável de ambiente
src/auth-kv.ts   sessão gravada no Deno KV (no lugar do useMultiFileAuthState)
src/obs.ts       log estruturado + contadores
src/wa.ts        um socket com o WhatsApp + funções de envio
src/server.ts    Deno.serve + uma tabela de rotas
```

O servidor abre **um** socket com o WhatsApp no boot e o mantém vivo. Isso é o
ponto central da arquitetura: a sessão do WhatsApp é uma conexão longa com
estado criptográfico que gira a cada mensagem (protocolo Signal). Ela não pode
ser recriada a cada requisição.

A sessão fica no **Deno KV**, não em disco — por isso o processo não precisa de
`--allow-write` fora do volume do KV.

Não tem Hono nem zod de propósito: oito rotas com payload plano não precisam de
router nem de biblioteca de schema. `Deno.serve` mais um
`Record<"MÉTODO /rota", função>` resolve. Vale trazer o Hono quando aparecer
middleware de verdade (auth, CORS) ou parâmetro de rota; e o zod quando o
payload ganhar aninhamento ou array.

## Rodando

```bash
deno task dev     # servidor + QR no terminal, com --watch
deno task start   # sem --watch
deno task test    # 21 testes, nenhum precisa de celular pareado
deno task check   # fmt + lint + typecheck
```

Leia o QR em **WhatsApp > Aparelhos conectados**. Depois de parear, a sessão
fica no KV e o pareamento não se repete.

### Docker

```bash
docker compose up          # QR aparece aqui nos logs
docker compose up -d       # em segundo plano
docker compose logs -f     # ver o QR / acompanhar
docker compose down        # para (mantém a sessão)
docker compose down -v     # para e APAGA a sessão (vai precisar parear de novo)
```

A sessão vive no volume gerenciado `kv` (`whatsapp-baileys_kv`), gravada como
banco SQLite em `/data/kv.sqlite3`. A pasta local `./arquivos` é montada como
somente leitura (`:ro`) e é de onde `/enviar-arquivo` lê os documentos.

#### Backup da Sessão (Deno KV)

Para inspecionar ou copiar a sessão ativa para sua máquina:

```bash
# Copiar o banco SQLite da sessão para uma pasta local
docker cp whatsapp-baileys:/data ./backup-sessao

# Inspecionar detalhes do volume gerenciado pelo Docker
docker volume inspect whatsapp-baileys_kv
```

## Rotas

| Método | Rota               | Corpo                       | O que faz                                    |
| ------ | ------------------ | --------------------------- | -------------------------------------------- |
| GET    | `/`                | —                           | ping                                         |
| GET    | `/status`          | —                           | conexão + métricas                           |
| POST   | `/iniciar`         | `{phone?}`                  | com `phone`: código de pareamento; sem: o QR |
| POST   | `/fechar`          | —                           | fecha o socket sem desparear                 |
| POST   | `/numero-valido`   | `{phone}`                   | o número existe no WhatsApp?                 |
| POST   | `/enviar-mensagem` | `{phone, texto}`            | envia texto                                  |
| POST   | `/enviar-imagem`   | `{phone, imagem, legenda?}` | `imagem`: URL http(s) ou base64              |
| POST   | `/enviar-arquivo`  | `{phone, arquivo}`          | `arquivo`: nome dentro de `./arquivos`       |

```bash
curl -X POST localhost:3000/enviar-mensagem \
  -d '{"phone":"+55 (62) 98557-8421","texto":"olá"}'
```

O `phone` aceita máscara — só os dígitos são usados. O JID nunca é montado na
mão: `sock.onWhatsApp()` devolve o JID real, e é isso que resolve o nono dígito
dos celulares brasileiros.

### Respostas de erro

| Código | Quando                                                        |
| ------ | ------------------------------------------------------------- |
| 400    | payload inválido (`phone inválido`, `texto obrigatório`, ...) |
| 404    | rota inexistente, número fora do WhatsApp, arquivo não achado |
| 503    | WhatsApp desconectado                                         |
| 500    | erro inesperado (vai pro log com stack)                       |

## Observabilidade

**Log estruturado**, uma linha JSON por evento, em stdout:

```bash
docker compose logs -f | jq 'select(.nivel == "erro")'
docker compose logs -f | jq 'select(.evento == "requisicao" and .ms > 500)'
```

```json
{
  "ts": "2026-08-18T19:55:55.366Z",
  "nivel": "info",
  "evento": "requisicao",
  "metodo": "GET",
  "rota": "/status",
  "status": 200,
  "ms": 92.8
}
```

Eventos: `servidor_iniciado`, `qr_gerado`, `conectado`, `desconectado`,
`reconectando`, `deslogado`, `enviado`, `requisicao`, `excecao`.

O payload **nunca** é logado — tem texto de mensagem e imagem em base64.

**Métricas** em `GET /status`:

```json
{
  "online": false,
  "qrPendente": true,
  "ultimaDesconexao": null,
  "metricas": {
    "uptimeSegundos": 10,
    "memoriaRssMb": 126.4,
    "memoriaHeapMb": 35,
    "requisicoes": 4,
    "erros": 0,
    "enviadas": 0,
    "falhasDeEnvio": 0
  }
}
```

`erros` conta só 5xx: 4xx é o cliente mandando errado, não falha do serviço.

**Healthcheck** do Docker bate em `/status` a cada 30s (`docker compose ps`
mostra `healthy`). Ele mede a saúde do _processo_ — para a saúde da _sessão_,
olhe o campo `online`.

**OpenTelemetry**, se quiser: o Deno instrumenta o `Deno.serve` e captura os
`console.log` como logs OTel sozinho, sem mudar código. Descomente no
`docker-compose.yml`:

```yaml
- OTEL_DENO=true
- OTEL_SERVICE_NAME=whatsapp-baileys
- OTEL_EXPORTER_OTLP_ENDPOINT=http://collector:4318
```

## Variáveis

| Nome             | Padrão       | Para quê                                         |
| ---------------- | ------------ | ------------------------------------------------ |
| `PORT`           | `3000`       | porta HTTP                                       |
| `SESSAO`         | `suporte`    | nome da sessão no KV (permite mais de um número) |
| `KV_PATH`        | padrão Deno  | caminho do KV; no Docker, `/data/kv.sqlite3`     |
| `PASTA_ARQUIVOS` | `./arquivos` | pasta lida por `/enviar-arquivo`                 |

## Onde dá pra hospedar

Precisa de host **sempre ligado**: VPS, Fly, Railway. O container roda em ~104
MB.

**Deno Deploy não serve**, e isso é arquitetural, não é bug. O Deploy derruba
isolate ocioso (entre 5s e 10min) e pode rodar várias instâncias regionais. O
Baileys precisa de uma conexão longa e única — duas instâncias com a mesma
credencial disparam conflito de sessão no WhatsApp, e reconectar sem parar
arrisca derrubar o número. Dá pra pôr uma camada HTTP no Deploy _na frente_ de
um daemon sempre ligado, mas o daemon tem que existir.

## Limitações conhecidas

- **Sem envio em massa.** O `enviarTudo()` do projeto antigo não foi trazido. Se
  voltar, tem que vir com o intervalo aleatório de 30–45s que o original tinha —
  disparar sem intervalo derruba o número.
- **Uma sessão por processo.** Vários números = vários containers, cada um com
  seu `SESSAO` e seu volume.
- **Baileys 7.x obrigatório.** A linha 6.x declara `libsignal` como dependência
  `git+https://`, e o Deno recusa dependência fora do npm. Não adianta "voltar
  pra 6.x estável": não instala.
