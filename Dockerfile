FROM node:22-slim

WORKDIR /app

# Install dependencies (keep dev deps so tsx can run TypeScript directly)
COPY package.json package-lock.json ./
RUN npm ci

# Copy source
COPY . .

# Default entrypoint: CLI
ENTRYPOINT ["npx", "tsx", "cli.ts"]
CMD ["--help"]
