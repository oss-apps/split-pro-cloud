FROM node:22.23.5-alpine AS base
ENV SKIP_ENV_VALIDATION="true"
ENV DOCKER_OUTPUT=1
ENV NEXT_TELEMETRY_DISABLED 1

RUN apk add --no-cache libc6-compat openssl
RUN apk update

WORKDIR /app
RUN npm i -g pnpm@8.9.2
RUN ls
COPY package.json pnpm-lock.yaml ./
# postinstall runs `prisma generate`, which needs the schema
COPY prisma ./prisma

RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm generate
RUN pnpm build

FROM node:22.23.5-alpine AS release
WORKDIR /app
RUN npm i -g pnpm@8.9.2

RUN apk add --no-cache libc6-compat openssl
RUN apk update


COPY --from=base /app/next.config.js .
COPY --from=base /app/package.json .
COPY --from=base /app/pnpm-lock.yaml .

COPY --from=base  /app/.next/standalone ./
COPY --from=base  /app/.next/static ./.next/static
COPY --from=base  /app/public ./public

COPY --from=base  /app/prisma/schema.prisma ./prisma/schema.prisma
COPY --from=base  /app/prisma/migrations ./prisma/migrations
COPY --from=base  /app/node_modules/@prisma ./node_modules/@prisma

# Migrations run with the Prisma CLI from the lockfile. The copied pnpm package can't run on its
# own (its dependencies live elsewhere in the store), and `pnpx prisma` would fetch the latest.
RUN npm i -g prisma@5.22.0

# set this so it throws error where starting server
ENV SKIP_ENV_VALIDATION="false"

COPY  ./docker/start.sh ./start.sh

CMD ["sh", "start.sh"]
