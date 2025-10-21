FROM node:20-alpine AS base
WORKDIR /usr/app

# ---- Dependencies ----
FROM base AS builder

COPY \
    .eslintrc.json \
    package.json \
    package-lock.json \
    tsconfig.json \
    jest.config.js \
    ./

COPY src ./src

RUN --mount=type=secret,id=npm_token \
    NPM_TOKEN="$(cat /run/secrets/npm_token)" && \
    echo "//npm.pkg.github.com/:_authToken=${NPM_TOKEN}" > .npmrc && \
    echo "@owneraio:registry=https://npm.pkg.github.com" >> .npmrc && \
    npm clean-install && \
    rm .npmrc
RUN npm run build

# ------- Release ----------
FROM base as release
LABEL org.opencontainers.image.source=https://github.com/owneraio/nodejs_ledger_adapter_skeleton

COPY --from=builder /usr/app/node_modules ./node_modules
COPY --from=builder /usr/app/dist ./dist
COPY --from=builder /usr/app/package.json ./

CMD [ "node", "/usr/app/dist/src/app/index.js" ]
