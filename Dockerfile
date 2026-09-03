FROM mcr.microsoft.com/playwright:v1.62.1-noble

WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile --prod
COPY --chown=pwuser:pwuser . .

RUN chown -R pwuser:pwuser /app
USER pwuser

ENV HEADLESS=true
CMD ["node", "src/cli.js"]
