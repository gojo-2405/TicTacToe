FROM node:18-alpine AS base
WORKDIR /app

# Copy package descriptors
COPY package*.json ./

# Install production dependencies
RUN npm install --omit=dev

# Copy application source code
COPY server.js ./
COPY db.js ./
COPY cognito.js ./
COPY schema.sql ./
COPY lambda/ ./lambda/

# Explicitly copy frontend public directory (ensures it is always included)
COPY public/ ./public/

EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

CMD ["node", "server.js"]
