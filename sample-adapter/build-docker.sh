#!/bin/sh

set -euo pipefail

docker build -t finp2p-nodejs-skeleton-adapter:latest \
  --secret id=npm_token,env=GITHUB_TOKEN \
  -f Dockerfile .
docker tag finp2p-nodejs-skeleton-adapter:latest localhost:5000/finp2p-nodejs-skeleton-adapter:latest
docker push localhost:5000/finp2p-nodejs-skeleton-adapter:latest
