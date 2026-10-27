# The app (screens + api/) as one container: what Vercel runs, on our own box.
# See server/web.js. Build context is the repo root:
#     docker build -f deploy/hub/web.Dockerfile \
#       --build-arg VITE_SUPABASE_URL=https://… --build-arg VITE_SUPABASE_ANON_KEY=… -t arak-web .
# The two VITE_ values are baked into the screens at build time, exactly as
# Vercel bakes them; they are public (the anon key is meant for browsers).

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
RUN test -n "$VITE_SUPABASE_URL" && test -n "$VITE_SUPABASE_ANON_KEY" && npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
# api/ imports src/lib (the agent and brand cores); server/ is the web server.
COPY api ./api
COPY src ./src
COPY server ./server
COPY vercel.json ./
COPY --from=build /app/dist ./dist
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1
CMD ["node", "server/web.js"]
