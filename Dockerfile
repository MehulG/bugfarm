FROM node:22-bookworm-slim AS build

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    build-essential \
    ca-certificates \
    git \
    python3 \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build
RUN npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
  PORT=3000 \
  ASSESSMENT_OUTPUT_DIR=/var/lib/bugfarm/artifacts \
  DATABASE_PATH=/var/lib/bugfarm/bugfarm.sqlite

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    git \
    python3 \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /var/lib/bugfarm/artifacts \
  && chown -R node:node /var/lib/bugfarm /app

COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/prompts ./prompts

USER node

EXPOSE 3000

CMD ["node", "dist/index.js"]
