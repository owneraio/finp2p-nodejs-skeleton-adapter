Nodejs ledger adapter skeleton








# Build docker image

docker build -f build/Dockerfile -t nodejs-adapter:latest .
docker tag nodejs-adapter:latest localhost:5000/nodejs-adapter:latest
docker push localhost:5000/nodejs-adapter:latest