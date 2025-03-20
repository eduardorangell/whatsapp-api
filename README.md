# WhatsApp API

Servidor REST API para automatizar certas funções do WhatsApp.

## Como usar

Inicie o servidor usando o comando `deno task dev` e leia o qr code com o
celular.

## Utilizando com Docker

Você pode iniciar uma instância do servidor usando o Docker:

```bash
docker run -p 3000:3000 -e WAIT_FOR_LOGIN=true -e HEADLESS=false -e USE_CHROME=true -e AUTO_CLOSE=90000 wpp-api
```

É possível também utilizando o arquivo docker-compose. Um arquivo de exemplo
pode ser encontrado na raiz do projeto. Antes de usar é necessário criar a
imagem do Docker:

```bash
deno run docker:build
```

Em seguida, execute o comando `docker-compose up -d` para iniciar o servidor.

## Desenvolvimento

Para iniciar o servidor em modo de desenvolvimento com todas as permissões:

```bash
deno task dev
```

Caso queira iniciar o servidor em produção e checar todas as permissões:

```bash
deno task start
```

Para iniciar o servidor utilizando o modo headless do puppeteer:

```bash
export HEADLESS=true && deno task dev
```

## Variáveis

| Nome             | Descrição                           | Valor padrão |
| ---------------- | ----------------------------------- | ------------ |
| PORT             | Porta de execução do servidor       | 3000         |
| WAIT_FOR_LOGIN   | Aguarda o retorno da instância      | false        |
| HEADLESS         | Ativa ou desativa chrome headless   | true         |
| USE_CHROME       | Usar Chrome ou Chromium             | false        |
| AUTO_CLOSE       | Fecha o navegador em x milisegundos | 90000        |
| WHATSAPP_VERSION | Versão do WhatsApp                  |              |
