FROM node:22-bookworm-slim AS build

WORKDIR /app

ARG CODESHEEP_BACKEND_URL=http://localhost:3000
ENV CODESHEEP_BACKEND_URL=$CODESHEEP_BACKEND_URL

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build
RUN npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
  PORT=3001 \
  HOSTNAME=0.0.0.0 \
  CODESHEEP_BACKEND_URL=http://localhost:3000

WORKDIR /app

COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/next.config.ts ./next.config.ts

EXPOSE 3001

CMD ["npm", "run", "start"]
