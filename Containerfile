# The media server with the eight media apps built in: what `ghcr.io/lmfaole/medier` is, built by `.github/workflows/image.yml` on every push to
# main that passed CI, and pulled by the machine (`deploy/media.container`, `podman auto-update`). No data and no key is in it: the databases are
# mounted at run time (`DATA_DIR`), and the build reads nothing but this repository.

FROM docker.io/library/node:24-slim AS build
WORKDIR /app
COPY . .
# engine-strict is on in .npmrc and this image is the Node it asks for, so the install is the one the machine would do.
RUN npm ci --no-audit --no-fund && npm run media:build

FROM docker.io/library/node:24-slim
WORKDIR /app
# The server reads the apps' builds, their `server/api.ts` (Node strips the types) and the shared packages from the source, so the whole tree goes in.
COPY --from=build /app /app
ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data \
    TZ=Europe/Oslo \
    NODE_OPTIONS=--max-old-space-size=1024
USER node
EXPOSE 3000
CMD ["node", "scripts/media-server.ts"]
