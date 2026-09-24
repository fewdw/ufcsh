FROM node:26-bookworm-slim AS client-build
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
ARG VITE_CLERK_PUBLISHABLE_KEY
ENV VITE_CLERK_PUBLISHABLE_KEY=$VITE_CLERK_PUBLISHABLE_KEY
ARG VITE_CLERK_PROXY_URL
ENV VITE_CLERK_PROXY_URL=$VITE_CLERK_PROXY_URL
ARG VITE_SITE_ORIGIN
ENV VITE_SITE_ORIGIN=$VITE_SITE_ORIGIN
RUN npm run build

FROM node:26-bookworm-slim AS runtime
ENV NODE_ENV=production DATA_DIR=/data PORT=8000 API_WORKERS=2
WORKDIR /app/server
# Share images are SVG text rasterised on the server; the slim image has no fonts.
RUN apt-get update && apt-get install -y --no-install-recommends fonts-dejavu-core && rm -rf /var/lib/apt/lists/*
COPY server/package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server/src ./src
COPY --from=client-build /app/client/dist /app/client/dist
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8000/readyz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/production.ts"]
