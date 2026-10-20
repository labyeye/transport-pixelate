FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
# Uploaded documents live here; mount a volume so they survive container replacement.
RUN mkdir -p /data/uploads && chown -R node:node /data /app
ENV UPLOAD_DIR=/data/uploads
USER node
EXPOSE 5100
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:5100/api/v1/health || exit 1
CMD ["node", "src/server.js"]
