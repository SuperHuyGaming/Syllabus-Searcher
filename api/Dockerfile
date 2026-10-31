# Runs the same Lambda handler behind a small Node HTTP server (scripts/local.js).
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY scripts ./scripts
USER node
EXPOSE 3001
CMD ["node", "scripts/local.js"]
