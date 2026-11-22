# syntax=docker/dockerfile:1
# Production image for Cloud Run: the web app (built with accounts on) and the
# API server in one container. See docs/GCP.md.
#   docker build -t beech --build-arg VITE_GOOGLE_CLIENT_ID=... .
#   docker run -p 8080:8080 -e DATABASE_URL=postgres://... beech

# ---- web app
FROM node:22-slim AS web
WORKDIR /app
COPY package.json package-lock.json ./
# (the optional "ca" secret only matters behind a TLS-inspecting proxy; CI and Cloud Build don't need it)
RUN --mount=type=secret,id=ca,required=false NODE_EXTRA_CA_CERTS=/run/secrets/ca npm ci --no-audit --no-fund
COPY index.html vite.config.ts tsconfig.json ./
COPY public ./public
COPY src ./src
ARG VITE_GOOGLE_CLIENT_ID=""
ENV VITE_ACCOUNTS=1 VITE_API_URL="" VITE_GOOGLE_CLIENT_ID=${VITE_GOOGLE_CLIENT_ID}
RUN npx tsc --noEmit && npx vite build

# ---- API server
FROM node:22-slim AS server
WORKDIR /srv
COPY server/package.json server/package-lock.json ./
RUN --mount=type=secret,id=ca,required=false NODE_EXTRA_CA_CERTS=/run/secrets/ca npm ci --no-audit --no-fund
COPY server/tsconfig.json ./
COPY server/src ./src
RUN npm run build && npm prune --omit=dev

# ---- runtime
FROM node:22-slim
ENV NODE_ENV=production PORT=8080 PUBLIC_DIR=/srv/public
WORKDIR /srv
COPY --from=server /srv/package.json ./
COPY --from=server /srv/node_modules ./node_modules
COPY --from=server /srv/build ./build
COPY --from=web /app/dist ./public
USER node
EXPOSE 8080
CMD ["node", "build/server.js"]
