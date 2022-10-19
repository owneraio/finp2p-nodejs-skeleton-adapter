# ---- Dependencies ----
FROM node:16-alpine AS base

WORKDIR /usr/app

# ---- Dependencies ----
FROM base AS ts-compiler

COPY . ./

#build server
RUN npm install
RUN npm run build

FROM base as ts-remover
COPY --from=ts-compiler /usr/app/package*.json ./
COPY --from=ts-compiler /usr/app/lib ./
RUN npm install --only=production

# ---- Release ----
FROM base as release
LABEL org.opencontainers.image.source=https://github.com/owneraio/nodejs_ledger_adapter_skeleton

COPY --from=ts-remover /usr/app ./
RUN ls -la
ENV NODE_ENV=production

# define CMD
CMD [ "node", "./server/index.js" ]