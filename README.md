# WhatsApp API

Servidor REST API em Deno para automatizar funções e envios no WhatsApp via
WPPConnect.

## Como usar

Inicie o servidor usando o comando `deno task dev` e leia o QR Code com o
WhatsApp no celular.

```bash
deno task dev    # Modo desenvolvimento com --watch
deno task start  # Modo produção
```

## Utilizando com Docker

Você pode iniciar uma instância do servidor usando Docker:

```bash
# Construir a imagem
deno task docker:build

# Iniciar o container
docker compose up -d
```

## Rotas da API

| Método | Rota               | Corpo                         | Descrição                                                     |
| ------ | ------------------ | ----------------------------- | ------------------------------------------------------------- |
| GET    | `/`                | —                             | Ping / Boas-vindas                                            |
| GET    | `/status`          | —                             | Checa o status da conexão do WhatsApp                         |
| POST   | `/iniciar`         | `{ phone? }`                  | Inicia a instância do navegador / sessão                      |
| POST   | `/fechar`          | —                             | Finaliza e fecha a sessão do navegador                        |
| POST   | `/numero-valido`   | `{ phone }`                   | Verifica se o número está registrado no WhatsApp              |
| POST   | `/enviar-mensagem` | `{ phone, texto }`            | Envia mensagem de texto simples                               |
| POST   | `/enviar-imagem`   | `{ phone, imagem, legenda? }` | Envia imagem (aceita caminho local, URL ou Base64)            |
| POST   | `/enviar-arquivo`  | `{ phone, arquivo }`          | Envia arquivo presente na pasta `./arquivos`                  |
| POST   | `/enviar-tudo`     | `{ numeros, texto, imagem? }` | Envio em lote com delay de segurança (30-45s) para evitar ban |

---

### Exemplos de Requisição

#### Enviar Mensagem de Texto

```bash
curl -X POST http://localhost:3000/enviar-mensagem \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "5562985578421",
    "texto": "Olá! Esta é uma mensagem de teste."
  }'
```

#### Enviar Imagem (URL, Caminho Local ou Base64)

```bash
# Via URL
curl -X POST http://localhost:3000/enviar-imagem \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "5562985578421",
    "imagem": "https://exemplo.com/banner.png",
    "legenda": "Confira nosso lançamento!"
  }'

# Via Caminho Local
curl -X POST http://localhost:3000/enviar-imagem \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "5562985578421",
    "imagem": "./jardins.jpeg",
    "legenda": "Foto do empreendimento"
  }'
```

#### Enviar em Lote (`/enviar-tudo`)

Dispara o envio para múltiplos números em segundo plano, respeitando um
intervalo aleatório de 30 a 45 segundos entre cada mensagem para proteger o
número contra banimento:

```bash
curl -X POST http://localhost:3000/enviar-tudo \
  -H "Content-Type: application/json" \
  -d '{
    "numeros": [
      "5562985578421",
      "5562983328888",
      "5562981530260"
    ],
    "texto": "Olá! Segue a apresentação do empreendimento.",
    "imagem": "./jardins.jpeg"
  }'
```

---

## Variáveis de Ambiente

| Nome               | Descrição                            | Valor padrão |
| ------------------ | ------------------------------------ | ------------ |
| `PORT`             | Porta de execução do servidor        | `3000`       |
| `WAIT_FOR_LOGIN`   | Aguarda o retorno da instância       | `false`      |
| `HEADLESS`         | Ativa ou desativa Chrome headless    | `true`       |
| `USE_CHROME`       | Usar Chrome ou Chromium              | `false`      |
| `AUTO_CLOSE`       | Fecha o navegador em x milissegundos | `90000`      |
| `WHATSAPP_VERSION` | Versão específica do WhatsApp Web    | _(auto)_     |
