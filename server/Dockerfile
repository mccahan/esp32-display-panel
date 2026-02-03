FROM oven/bun:alpine AS builder

WORKDIR /app

# Copy package files
COPY package.json bun.lock ./

# Install dependencies
RUN bun install --frozen-lockfile

# Copy source code
COPY tsconfig.json ./
COPY src ./src
COPY public ./public

# Build TypeScript
RUN bun run build

# Production image
FROM oven/bun:alpine

WORKDIR /app

# Copy package files and install production dependencies only
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# Copy built files and public assets
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public

# Create data directory
RUN mkdir -p data

# Expose port
EXPOSE 3000

# Set environment variables
ENV PORT=3000

# Run the server
CMD ["bun", "dist/index.js"]
