# whatsapp-api

API HTTP para envio de mensagens, imagens e arquivos pelo WhatsApp escrita em
**Deno puro** — sem Node.js e sem frameworks pesados (como Hono ou Express).

A aplicação conta com uma **arquitetura de motor unificada**, permitindo
escolher facilmente qual tecnologia utilizar antes de iniciar o serviço:

1. **Baileys (`WA_ENGINE=baileys` - Padrão):**
   - Comunicação direta via WebSocket com os servidores do WhatsApp Web.
   - Criptografia do protocolo Signal compilada nativamente em WebAssembly
     (`whatsapp-rust-bridge`).
   - Sem navegador: consome apenas **~104 MB de RAM**.
   - Credenciais e chaves criptográficas salvas 100% no **Deno KV**.

2. **WPPConnect (`WA_ENGINE=wppconnect`):**
   - Automação do WhatsApp Web completo utilizando Google Chrome / Chromium
     headless via Puppeteer.
   - Perfil do navegador e tokens persistidos na pasta `./data/tokens`.

Ambos os motores compartilham a **mesma tabela de rotas**, o mesmo formato de
respostas, a mesma base de **leads com cooldown anti-bloqueio**, sistema de
**spintax** e métricas de observabilidade.

---

## Como funciona

```
src/env.ts              configuração por variáveis de ambiente
src/auth-kv.ts          persistência da sessão Baileys no Deno KV
src/leads.ts            gestão de leads e cooldown anti-spam no Deno KV
src/obs.ts              log estruturado JSON + contadores de métricas
src/util.ts             utilitários comuns (telefone, spintax, delay, MIME)
src/engines/types.ts    interface comum WhatsAppEngine
src/engines/baileys.ts   implementação do motor Baileys
src/engines/wppconnect.ts implementação do motor WPPConnect
src/engines/factory.ts  fábrica com lazy-loading dinâmico dos motores
src/wa.ts               fachada unificada para retrocompatibilidade
src/server.ts           servidor HTTP nativo (Deno.serve) com tabela de rotas
scripts/build_docker.ts script CLI para compilação modular das imagens Docker
```

---

## Rodando Localmente

### 1. Com o motor padrão (Baileys)

```bash
deno task dev     # servidor + QR / pairing code no terminal, com --watch
deno task start   # modo produção (sem --watch)
```

### 2. Com o motor WPPConnect

```bash
WA_ENGINE=wppconnect deno task dev
```

### Testes e Verificação

```bash
deno task test    # executa a suíte de testes unitários (sem precisar de celular pareado)
deno task check   # formatação (fmt), linter e checagem de tipos (deno check)
```

---

## Docker e Imagens Modulares

O repositório disponibiliza Dockerfiles específicos para cada cenário,
otimizando o consumo de espaço e memória:

- **`Dockerfile.baileys`**: Imagem enxuta de ~150 MB, sem Google Chrome ou
  dependências gráficas.
- **`Dockerfile.wppconnect`**: Imagem completa baseada em Debian com Google
  Chrome / Chromium e fontes instaladas.

### Build das Imagens

Você pode compilar as imagens através da tarefa CLI dedicada:

```bash
# Build da imagem com Baileys (gera whatsapp-api:baileys e whatsapp-api:latest)
deno task build:docker --baileys

# Build da imagem com WPPConnect (gera whatsapp-api:wppconnect)
deno task build:docker --wppconnect
```

### Executando com Docker Compose

O arquivo [`docker-compose.yml`](docker-compose.yml) unifica a persistência na
pasta `./data`:

- `./data/kv.sqlite3`: Dados de leads, cooldown anti-spam, métricas e sessão do
  Baileys.
- `./data/tokens`: Pasta de perfil e tokens de sessão do Chrome para o
  WPPConnect.

```bash
# Subir com Baileys (padrão):
docker compose up -d

# Subir com WPPConnect:
WA_ENGINE=wppconnect docker compose up -d

# Acompanhar logs e visualizar o QR Code ou Código de Pareamento:
docker compose logs -f

# Parar o serviço (mantendo a sessão):
docker compose down

# Parar e APAGAR a sessão (será necessário parear novamente):
docker compose down -v
```

---

## Rotas e Exemplos de Uso

| Método | Rota               | Corpo                        | O que faz                                             |
| ------ | ------------------ | ---------------------------- | ----------------------------------------------------- |
| GET    | `/`                | —                            | Ping / verificação da API                             |
| GET    | `/status`          | —                            | Conexão ativa, motor atual, status do QR e métricas   |
| POST   | `/iniciar`         | `{phone?}`                   | Inicia pareamento por código ou via QR                |
| POST   | `/fechar`          | —                            | Desconecta a sessão sem desparear                     |
| POST   | `/logout`          | —                            | Desconecta do WhatsApp e limpa as credenciais locais  |
| POST   | `/numero-valido`   | `{phone}`                    | Valida se o número possui WhatsApp ativo e obtém JID  |
| POST   | `/enviar-mensagem` | `{phone, texto}`             | Envia mensagem de texto simples                       |
| POST   | `/enviar-imagem`   | `{phone, imagem, legenda?}`  | Envia imagem via URL, base64 ou caminho local         |
| POST   | `/enviar-arquivo`  | `{phone, arquivo, legenda?}` | Envia documento/arquivo da pasta `./arquivos`         |
| POST   | `/enviar-tudo`     | `{numeros, texto, imagem?}`  | Dispara lote assíncrono com delay anti-ban (30 a 45s) |
| GET    | `/leads`           | —                            | Lista leads salvos com filtro por `status` e `limite` |
| GET    | `/leads/resumo`    | —                            | Quantitativo de leads agrupados por status            |
| GET    | `/leads/exportar`  | —                            | Exporta números em JSON ou TXT (pronto para disparo)  |

> O campo `phone` aceita máscara (`+55 (62) 98557-8421` ou `5562985578421`) —
> apenas os dígitos são considerados. O JID real é consultado via WhatsApp para
> tratar automaticamente o nono dígito de celulares brasileiros.
>
> **Recursos Anti-Bloqueio Nativos:**
>
> - **Simulação de Digitação Humana:** Antes de cada envio, o servidor ativa o
>   status `"digitando..."` proporcionalmente ao tamanho do texto (mínimo 1.5s,
>   máximo 10s), emulando um usuário real.
> - **Spintax (Variação de Texto):** Textos e legendas suportam rotação
>   aleatória `{opção 1|opção 2|opção 3}` (ex: `"{Olá|Oi|Bom dia}, tudo bem?"`),
>   gerando mensagens distintas a cada envio.
> - **Cooldown de Leads:** No `/enviar-tudo`, o parâmetro `diasCooldown` impede
>   que um contato que já recebeu mensagem nos últimos N dias seja incomodado
>   novamente.

---

### Exemplos de Requisições (cURL)

#### 1. Status da Conexão (`GET /status`)

```bash
curl -s http://localhost:3000/status
```

```json
{
  "motor": "baileys",
  "online": true,
  "sessaoIniciada": true,
  "usuario": {
    "id": "556293340220:25@s.whatsapp.net"
  },
  "qrPendente": false,
  "ultimaDesconexao": null,
  "metricas": {
    "uptimeSegundos": 120,
    "memoriaRssMb": 104.2,
    "memoriaHeapMb": 36.1,
    "requisicoes": 12,
    "erros": 0,
    "enviadas": 5,
    "falhasDeEnvio": 0
  }
}
```

#### 2. Iniciar Pareamento (`POST /iniciar`)

- **Via Código de Pareamento de 8 dígitos (Recomendado - sem escanear câmera):**

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

#### 3. Enviar Mensagem de Texto (`POST /enviar-mensagem`)

```bash
curl -X POST http://localhost:3000/enviar-mensagem \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "5562985578421",
    "texto": "{Olá|Oi}! Seu pedido #1024 foi confirmado com sucesso."
  }'
```

#### 4. Enviar Imagem (`POST /enviar-imagem`)

```bash
# Via URL pública ou arquivo local em ./arquivos
curl -X POST http://localhost:3000/enviar-imagem \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "5562985578421",
    "imagem": "promocao.jpg",
    "legenda": "{Confira|Veja} as ofertas imperdíveis!"
  }'
```

#### 5. Enviar Arquivo / Documento (`POST /enviar-arquivo`)

```bash
curl -X POST http://localhost:3000/enviar-arquivo \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "5562985578421",
    "arquivo": "tabela-precos.pdf",
    "legenda": "Segue nossa tabela atualizada."
  }'
```

#### 6. Disparo em Lote com Delay Anti-Ban (`POST /enviar-tudo`)

```bash
curl -X POST http://localhost:3000/enviar-tudo \
  -H "Content-Type: application/json" \
  -d '{
    "numeros": ["5562985578421", "5562983328888"],
    "texto": "{Olá|Oi}, tudo bem?",
    "imagem": "banner.png",
    "diasCooldown": 15
  }'
```

#### 7. Gestão de Leads (`GET /leads/exportar`)

```bash
# Exportar lista limpa em arquivo texto:
curl -s "http://localhost:3000/leads/exportar?status=valido&formato=txt"
```

---

## Variáveis de Ambiente

| Variável         | Padrão          | Descrição                                                   |
| ---------------- | --------------- | ----------------------------------------------------------- |
| `WA_ENGINE`      | `baileys`       | Motor WhatsApp ativo: `baileys` ou `wppconnect`             |
| `PORT`           | `3000`          | Porta do servidor HTTP                                      |
| `SESSAO`         | `suporte`       | Nome da sessão ativa                                        |
| `KV_PATH`        | Deno default    | Caminho do banco Deno KV (no container: `/data/kv.sqlite3`) |
| `PASTA_ARQUIVOS` | `./arquivos`    | Pasta local de onde `/enviar-arquivo` lê os documentos      |
| `WPP_TOKENS_DIR` | `./data/tokens` | Diretório dos tokens e perfil Chromium do WPPConnect        |
| `HEADLESS`       | `true`          | Executar Chrome em modo headless no WPPConnect              |
| `USE_CHROME`     | `true`          | Utilizar o binário do Chrome instalado no sistema           |

---

## Onde Hospedar

Requer host **sempre ligado**: VPS (Debian/Ubuntu), Docker Swarm, Fly.io,
Railway.

- Imagem Baileys: consome ~104 MB de RAM.
- Imagem WPPConnect: consome ~350–500 MB de RAM com as abas do Chrome.

_Nota arquitetural: O Deno Deploy não é indicado pois encerra isolates ociosos e
roda réplicas efêmeras que quebram o estado de conexões de longa duração do
WhatsApp Web._
