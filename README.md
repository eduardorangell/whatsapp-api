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

## Rotas e Exemplos de Uso

| Método | Rota               | Corpo                       | O que faz                                             |
| ------ | ------------------ | --------------------------- | ----------------------------------------------------- |
| GET    | `/`                | —                           | Ping / verificação da API                             |
| GET    | `/status`          | —                           | Conexão ativa, status do QR e métricas                |
| POST   | `/iniciar`         | `{phone?}`                  | Inicia pareamento por código ou via QR                |
| POST   | `/fechar`          | —                           | Desconecta o socket sem desparear a sessão            |
| POST   | `/logout`          | —                           | Desconecta do WhatsApp e apaga a sessão do Deno KV    |
| POST   | `/numero-valido`   | `{phone}`                   | Valida se o número possui WhatsApp ativo e obtém JID  |
| POST   | `/enviar-mensagem` | `{phone, texto}`            | Envia mensagem de texto simples                       |
| POST   | `/enviar-imagem`   | `{phone, imagem, legenda?}` | Envia imagem via URL, base64 ou caminho local         |
| POST   | `/enviar-arquivo`  | `{phone, arquivo}`          | Envia documento/arquivo da pasta `./arquivos`         |
| POST   | `/enviar-tudo`     | `{numeros, texto, imagem?}` | Dispara lote assíncrono com delay anti-ban (30 a 45s) |

> O campo `phone` aceita máscara (`+55 (62) 98557-8421` ou `5562985578421`) —
> apenas os dígitos são considerados. O JID real é consultado via WhatsApp para
> tratar automaticamente o nono dígito de celulares brasileiros.
>
> **Recursos Anti-Bloqueio Nativos:**
>
> - **Simulação de Digitação Humana:** Antes de cada envio, o servidor ativa o
>   status `"digitando..."` por um período proporcional ao tamanho do texto
>   (mínimo 1.5s, máximo 10s), emulando um usuário real no WhatsApp Web.
> - **Spintax (Variação de Texto):** Textos e legendas suportam sintaxe de
>   rotação aleatória `{opção 1|opção 2|opção 3}` (ex:
>   `"{Olá|Oi|Bom dia}, tudo bem?"`), evitando impressões digitais/hashes
>   idênticos em disparos múltiplos.

---

### Exemplos de Requisições (cURL)

#### 1. Ping (`GET /`)

Verifica se o servidor HTTP está online e respondendo.

```bash
curl -s http://localhost:3000/
```

```json
{
  "mensagem": "Olá"
}
```

#### 2. Status e Métricas (`GET /status`)

Exibe se o WhatsApp está conectado, se há QR pendente e as métricas de runtime.

```bash
curl -s http://localhost:3000/status
```

```json
{
  "online": true,
  "sessaoIniciada": true,
  "usuario": {
    "id": "556293340220:25@s.whatsapp.net",
    "name": "Suporte"
  },
  "qrPendente": false,
  "ultimaDesconexao": null,
  "metricas": {
    "uptimeSegundos": 124,
    "memoriaRssMb": 112.5,
    "memoriaHeapMb": 38.2,
    "requisicoes": 15,
    "erros": 0,
    "enviadas": 5,
    "falhasDeEnvio": 0
  }
}
```

#### 3. Iniciar Conexão / Pareamento (`POST /iniciar`)

Gera código de pareamento de 8 dígitos (se informado `phone`) ou gera o QR Code
no terminal e na resposta.

- **Via Código de Pareamento (Recomendado - sem escanear câmera):**

```bash
curl -X POST http://localhost:3000/iniciar \
  -H "Content-Type: application/json" \
  -d '{"phone": "5562985578421"}'
```

```json
{
  "status": "aguardando pareamento",
  "codigo": "PR3L-T6PV"
}
```

- **Via QR Code:**

```bash
curl -X POST http://localhost:3000/iniciar \
  -H "Content-Type: application/json" \
  -d '{}'
```

```json
{
  "status": "aguardando leitura",
  "qr": "2@4lKm...==,k5...==,1"
}
```

#### 4. Fechar Conexão (`POST /fechar`)

Desconecta o socket atual sem apagar as credenciais salvas no Deno KV.

```bash
curl -X POST http://localhost:3000/fechar
```

```json
{
  "finalizado": true
}
```

#### 5. Logout Definitivo (`POST /logout`)

Desconecta do WhatsApp, desvincula o aparelho na rede e remove completamente a
sessão e chaves do Deno KV.

```bash
curl -X POST http://localhost:3000/logout
```

```json
{
  "deslogado": true
}
```

#### 6. Verificar se Número Existe no WhatsApp (`POST /numero-valido`)

Checa se um número possui conta no WhatsApp e devolve o JID exato.

```bash
curl -X POST http://localhost:3000/numero-valido \
  -H "Content-Type: application/json" \
  -d '{"phone": "+55 62 98557-8421"}'
```

```json
{
  "existe": true,
  "jid": "556285578421@s.whatsapp.net"
}
```

#### 6. Enviar Mensagem de Texto (`POST /enviar-mensagem`)

Envia mensagem de texto simples.

```bash
curl -X POST http://localhost:3000/enviar-mensagem \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "5562985578421",
    "texto": "Olá! Seu pedido #1024 foi confirmado."
  }'
```

```json
{
  "jid": "556285578421@s.whatsapp.net",
  "id": "3EB0C824E5B84F0D"
}
```

#### 7. Enviar Imagem (`POST /enviar-imagem`)

Aceita imagem por **URL HTTP(S)**, **caminho de arquivo local** ou **Data URI /
Base64**, com legenda opcional.

```bash
# Exemplo com URL pública
curl -X POST http://localhost:3000/enviar-imagem \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "5562985578421",
    "imagem": "https://picsum.photos/600/400",
    "legenda": "Confira a foto do imóvel atualizada"
  }'

# Exemplo com arquivo local na pasta de arquivos
curl -X POST http://localhost:3000/enviar-imagem \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "5562985578421",
    "imagem": "foto.jpeg",
    "legenda": "Anexo local"
  }'
```

```json
{
  "jid": "556285578421@s.whatsapp.net",
  "id": "3EB0C824E5B84F0E"
}
```

#### 8. Enviar Arquivo / Documento (`POST /enviar-arquivo`)

Envia arquivos (PDF, DOCX, XLSX, etc.) localizados dentro da pasta de arquivos
configurada (`./arquivos`).

```bash
curl -X POST http://localhost:3000/enviar-arquivo \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "5562985578421",
    "arquivo": "contrato.pdf"
  }'
```

```json
{
  "jid": "556285578421@s.whatsapp.net",
  "id": "3EB0C824E5B84F0F"
}
```

#### 9. Envio em Lote em Segundo Plano (`POST /enviar-tudo`)

Dispara o envio para uma lista de contatos em segundo plano, aplicando um
intervalo aleatório seguro de 30 a 45 segundos entre cada envio para proteção
contra bloqueio/banimento.

```bash
curl -X POST http://localhost:3000/enviar-tudo \
  -H "Content-Type: application/json" \
  -d '{
    "numeros": ["5562985578421", "5562983328888"],
    "texto": "Aviso geral importante para todos os clientes.",
    "imagem": "banner.png"
  }'
```

```json
{
  "status": "iniciado",
  "total": 2,
  "mensagem": "Envio em lote iniciado em segundo plano com intervalo de segurança (30 a 45s)."
}
```

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

- **Envio em lote com delay anti-ban.** O `/enviar-tudo` executa com intervalo
  aleatório de 30 a 45 segundos entre cada mensagem para proteger o número
  contra bloqueios.
- **Uma sessão por processo.** Vários números = vários containers, cada um com
  seu `SESSAO` e seu volume.
- **Baileys 7.x obrigatório.** A linha 6.x declara `libsignal` como dependência
  `git+https://`, e o Deno recusa dependência fora do npm. Não adianta "voltar
  pra 6.x estável": não instala.
