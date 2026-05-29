# syntax=docker/dockerfile:1

# ---- build stage: compile TS -> dist/ ----
FROM node:22-alpine AS build
WORKDIR /app

# install ALL deps (incl. devDeps: typescript, etc.) for the build
COPY package*.json ./
RUN npm ci

# compile
COPY . .
RUN npm run build

# ---- runtime stage: slim production image ----
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# tini/dumb-init becomes PID 1 and forwards signals (SIGTERM) to node so
# graceful shutdown works under Fargate/Kubernetes (node as PID 1 mishandles signals)
RUN apk add --no-cache dumb-init

# install ONLY production deps (no typescript/eslint/vitest/etc.)
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# copy compiled output from the build stage
COPY --from=build --chown=node:node /app/dist ./dist

# drop root — run as the unprivileged `node` user
USER node

EXPOSE 3000

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/server.js"]
