FROM node:16-alpine AS base
WORKDIR /usr/app

# ---- Dependencies ----
FROM base AS builder

COPY \
    package.json \
    yarn.lock \
    ./

#COPY package*.json ./
#COPY tsconfig.json ./
#COPY .eslintrc.json ./
#COPY src ./src
#COPY tests ./tests
#COPY jest.config.js ./

RUN yarn install --frozen-lockfile --production=true

# ------- Release ----------
FROM base as release
LABEL org.opencontainers.image.source=https://github.com/owneraio/nodejs_ledger_adapter_skeleton

COPY --from=builder /usr/app/node_modules ./node_modules
#COPY --from=build /usr/app/package*.json ./server/
#COPY --from=build /usr/app/server/lib ./server/
COPY package.json .
RUN yarn link

ENV NODE_ENV=production

CMD [ "node", "/usr/app/server/index.js" ]