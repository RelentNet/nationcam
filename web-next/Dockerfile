# Stage 1: Build the SSR bundle
FROM node:24-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Build-time env vars (passed via docker-compose build args). Logto runs in the
# browser, so its config is baked into the client bundle exactly as it is for
# the old SPA. The API base URL is NOT baked in — it is read from `API_URL` at
# runtime, so the same image works in any environment.
ARG VITE_LOGTO_ENDPOINT=""
ARG VITE_LOGTO_APP_ID=""
ARG VITE_LOGTO_API_RESOURCE=""

RUN echo "Building with VITE_LOGTO_ENDPOINT=$VITE_LOGTO_ENDPOINT" && \
    npm run build

# Stage 2: Run the Nitro server output
FROM node:24-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Nitro bundles its dependencies into .output, so no node_modules are needed.
COPY --from=build /app/.output ./.output

EXPOSE 3000

CMD ["node", ".output/server/index.mjs"]
