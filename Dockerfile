# ==========================================
# Stage 1: Builder
# ==========================================
FROM node:20-bookworm-slim AS builder

WORKDIR /usr/src/app

# Instalar dependencias completas para el build
COPY package*.json ./
RUN npm ci

# Copiar código fuente
COPY client ./client
COPY src ./src
COPY scripts ./scripts
COPY server.js ./
COPY config.json ./
COPY knowledge.md ./

# Generar build (carpeta public/)
RUN npm run build

# Limpiar dependencias de desarrollo
RUN npm prune --production

# ==========================================
# Stage 2: Runner
# ==========================================
FROM node:20-bookworm-slim

WORKDIR /usr/src/app

ENV NODE_ENV=production

# Copiar solo lo necesario desde el builder
COPY --from=builder /usr/src/app/package*.json ./
COPY --from=builder /usr/src/app/node_modules ./node_modules
COPY --from=builder /usr/src/app/server.js ./
COPY --from=builder /usr/src/app/.embeddings_cache.json ./
COPY --from=builder /usr/src/app/src ./src
COPY --from=builder /usr/src/app/config.json ./
COPY --from=builder /usr/src/app/knowledge.md ./
RUN mkdir -p data
VOLUME ["/usr/src/app/data"]
COPY --from=builder /usr/src/app/public ./public

# Puerto expuesto
EXPOSE 3000

# Comando de arranque
CMD ["npm", "start"]
