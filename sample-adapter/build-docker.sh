#!/bin/sh

set -euo pipefail

docker build -t finp2p-nodejs-skeleton-adapter-migrations:latest -f ./db-migrations/Dockerfile .
docker tag finp2p-nodejs-skeleton-adapter-migrations:latest localhost:5000/finp2p-nodejs-skeleton-adapter-migrations:latest
docker push localhost:5000/finp2p-nodejs-skeleton-adapter-migrations:latest

docker build -t finp2p-nodejs-skeleton-adapter:latest -f Dockerfile .
docker tag finp2p-nodejs-skeleton-adapter:latest localhost:5000/finp2p-nodejs-skeleton-adapter:latest
docker push localhost:5000/finp2p-nodejs-skeleton-adapter:latest

