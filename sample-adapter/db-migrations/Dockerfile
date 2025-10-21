# ---- compile goose (migration tool) ----
FROM golang:1.24.5-alpine AS builder

RUN apk update && apk add make gcc git build-base
RUN go install github.com/pressly/goose/v3/cmd/goose@v3.26.0

# ---- migration sql files are in the skeleton. install them ----
FROM node:20-alpine AS migrations
WORKDIR /usr/app
COPY ./package.json ./package-lock.json .

RUN --mount=type=secret,id=npm_token \
    NPM_TOKEN="$(cat /run/secrets/npm_token)" && \
    echo "//npm.pkg.github.com/:_authToken=${NPM_TOKEN}" > .npmrc && \
    echo "@owneraio:registry=https://npm.pkg.github.com" >> .npmrc && \
    npm clean-install && \
    rm .npmrc

# ---- ready to run migrations ----
FROM alpine:latest
WORKDIR /usr/app
COPY --from=builder /go/bin/goose /usr/bin/
#COPY --from=migrations /usr/app/node_modules/@owneraio/finp2p-nodejs-skeleton-adapter/migrations/*.sql ./

CMD ["/usr/bin/goose", "up"]
