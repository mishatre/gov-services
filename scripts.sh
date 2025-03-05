docker build --platform linux/amd64 --build-arg SSH_PRIVATE_KEY="$(cat ~/.ssh/id_ed25519)" -t=eis .
docker tag eis ghcr.io/mishatre/eis:latest

docker build --platform linux/amd64 --build-arg SSH_PRIVATE_KEY="$(cat ./certs/id_ed25519)" -t=ghcr.io/mishatre/eis .
docker push ghcr.io/mishatre/eis:latest
