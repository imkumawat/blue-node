# syntax=docker/dockerfile:1

# ---- build stage: compile TS -> dist/ ----
FROM node:24-alpine AS build
WORKDIR /app

# install ALL deps (incl. devDeps: typescript, etc.) for the build
COPY package*.json ./
RUN npm ci

# compile
COPY . .
RUN npm run build

# ---- runtime stage: slim production image ----
FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# dumb-init becomes PID 1. Two reasons:
#  1. Signal forwarding — PID 1 has special kernel semantics; node as PID 1 can
#     mishandle SIGTERM, so the graceful-shutdown handler never fires and the
#     container gets SIGKILL'd (dropped in-flight requests). dumb-init forwards
#     SIGTERM/SIGINT to node so shutdown drains cleanly under Fargate/Kubernetes.
#  2. Zombie reaping — PID 1 must reap orphaned child processes; node isn't an
#     init system and won't, so zombies would accumulate. dumb-init reaps them.
RUN apk add --no-cache dumb-init

# install ONLY production deps (no typescript/eslint/vitest/etc.)
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# copy compiled output from the build stage
COPY --from=build --chown=node:node /app/dist ./dist

# drop root — run as the unprivileged `node` user
USER node

EXPOSE 3000

# ENTRYPOINT is fixed → everything runs under dumb-init (signal forwarding +
# zombie reaping apply to ANY command, web or worker).
# CMD is the DEFAULT command (web server). It can be overridden per deployment
# without changing this image — e.g. an ECS worker task sets
#   command: ["node", "dist/worker.js"]
# which replaces CMD only, keeping the dumb-init ENTRYPOINT. Same image, two roles.
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/server.js"]
