# Web app (static) + Caddy reverse proxy. Built with the server's domain baked in.
FROM node:22-bookworm-slim AS build
ARG DOMAIN
RUN corepack enable
WORKDIR /src
COPY . .
ENV VITE_OIDC_AUTHORITY=https://${DOMAIN}/id/realms/office VITE_OIDC_CLIENT_ID=office-web
RUN pnpm install --frozen-lockfile && pnpm --filter @office/web build

FROM caddy:2.8-alpine
COPY --from=build /src/apps/web/dist /srv
COPY infra/trial/Caddyfile /etc/caddy/Caddyfile
