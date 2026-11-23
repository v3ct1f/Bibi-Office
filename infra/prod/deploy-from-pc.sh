#!/bin/sh
# Sends the committed project to the server and (re)starts Office. Run on your PC, from anywhere inside the repo:
#   sh infra/prod/deploy-from-pc.sh root@SERVER_IP [path-to-ssh-key]
# Only COMMITTED files are sent (secrets such as .env.local are never in a release). Releases are kept side by side in
# /opt/office/releases; /opt/office/current points at the active one, so going back is a one-line change.
set -eu
host=${1:?usage: deploy-from-pc.sh user@server [ssh-key]}
key=${2:-$HOME/.ssh/bibi-office-deploy}
cd "$(git rev-parse --show-toplevel)"
git diff --quiet HEAD -- || { echo "You have uncommitted changes. Commit first: only committed files are deployed."; exit 1; }
rel=$(git rev-parse --short HEAD)
tmp=$(mktemp -d)
git archive --format=tar.gz -o "$tmp/office-$rel.tar.gz" HEAD
ssh_opts="-i $key -o StrictHostKeyChecking=accept-new"
scp $ssh_opts "$tmp/office-$rel.tar.gz" "$host:/tmp/office-$rel.tar.gz"
ssh $ssh_opts "$host" "set -e
  mkdir -p /opt/office/releases/$rel
  tar -xzf /tmp/office-$rel.tar.gz -C /opt/office/releases/$rel
  rm /tmp/office-$rel.tar.gz
  [ -f /opt/office/.env ] || { echo 'Missing /opt/office/.env: run make-env.sh first.'; exit 1; }
  ln -sfn /opt/office/releases/$rel /opt/office/current
  cd /opt/office/current/infra/prod
  cp /opt/office/.env .env
  docker compose --env-file .env build
  docker compose --env-file .env up -d
  docker compose --env-file .env ps
  # keep the 3 newest releases
  cd /opt/office/releases && ls -1t | tail -n +4 | xargs -r rm -rf
  docker image prune -f >/dev/null"
rm -rf "$tmp"
echo "Deployed release $rel."
