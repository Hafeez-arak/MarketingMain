# The research agent, next to n8n.
#
# Holds only what api/agent/*.js imports: the handlers, the Zernio client they
# share, src/lib (the pure agent modules and the brand context cores), and the
# one runtime dependency, the Anthropic SDK. No React, no Vite, no build step —
# the handlers are plain ESM that run under Node as-is, which
# src/lib/agent/nodeBoundary.test.js already asserts.
#
# Build context is the repo root (see n8n/docker/docker-compose.yml):
#     docker compose up -d --build agent
FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

# A package.json of its own rather than the app's, whose dependencies are the
# whole front end. "type": "module" is what lets the .js handlers load as ESM.
# The SDK version is pinned to the one package-lock.json resolves, so the
# container and Vercel run the same client.
RUN printf '{"name":"arak-agent","private":true,"type":"module"}\n' > package.json \
 && npm install --omit=dev --no-audit --no-fund @anthropic-ai/sdk@0.124.0 \
 && npm cache clean --force

COPY api/agent ./api/agent
COPY api/zernio/_zernio.js ./api/zernio/_zernio.js
COPY src/lib ./src/lib
COPY server/agent.js ./server/agent.js

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/healthz >/dev/null || exit 1

CMD ["node", "server/agent.js"]
