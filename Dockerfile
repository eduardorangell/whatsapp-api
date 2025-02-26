FROM denoland/deno

RUN apt-get update \
    && apt-get install -y wget gnupg \
    && wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add - \
    && sh -c 'echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google.list' \
    && apt-get update \
    && apt-get install -y google-chrome-stable fonts-ipafont-gothic fonts-wqy-zenhei fonts-thai-tlwg fonts-kacst fonts-freefont-ttf libxss1 \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

EXPOSE 3000

WORKDIR /app

COPY . .

RUN deno cache server.ts && deno install --allow-scripts=npm:puppeteer@23.11.1,npm:sharp@0.33.5

RUN timeout 10s deno -A server.ts || [ $? -eq 124 ] || exit 1

CMD ["run", "--allow-net", "--allow-read", "--allow-write", "--allow-env", "--allow-sys", "--allow-ffi", "--allow-run", "server.ts"]
