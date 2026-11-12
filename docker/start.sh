#!/bin/sh

set -ex

echo "Deploying prisma migrations"

prisma migrate deploy --schema ./prisma/schema.prisma

echo "Starting web server"

node server.js

