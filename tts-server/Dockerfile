# SA Maps voice server (Kokoro-82M, CPU).
FROM node:22-bookworm-slim

# ONNXRUNTIME_NODE_INSTALL_CUDA=skip: onnxruntime-node's postinstall would otherwise download
# several hundred MB of CUDA libraries on linux/x64 that a CPU-only server never uses.
ENV NODE_ENV=production \
    PORT=8787 \
    MODEL_DIR=/data/models \
    CACHE_DIR=/data/cache \
    ONNXRUNTIME_NODE_INSTALL_CUDA=skip

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund \
 && npm cache clean --force

COPY server.js ./
COPY lib ./lib
COPY scripts ./scripts

# Run as the image's unprivileged "node" user; /data holds the model download + clip cache.
RUN mkdir -p /data/models /data/cache && chown -R node:node /data
USER node
VOLUME /data

EXPOSE 8787

# Healthy only once the model is loaded and warmed up (first start downloads the model).
HEALTHCHECK --interval=30s --timeout=5s --start-period=600s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/health').then(r=>r.json()).then(j=>process.exit(j.ready?0:1)).catch(()=>process.exit(1))"

STOPSIGNAL SIGTERM
CMD ["node", "server.js"]
