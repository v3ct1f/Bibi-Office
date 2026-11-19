# Multi-stage build for api and worker. docker build --build-arg APP=api -t office-api .
FROM node:22-alpine AS build
ARG APP=api
RUN corepack enable
WORKDIR /src
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter @office/${APP} build \
 && pnpm --filter @office/${APP} deploy --prod --legacy /out

FROM gcr.io/distroless/nodejs22-debian12:nonroot
WORKDIR /app
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/dist ./dist
USER nonroot
# api entry: dist/server.js; worker: override with CMD ["dist/main.js"]
CMD ["dist/server.js"]
