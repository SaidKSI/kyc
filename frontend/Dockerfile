FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# Install PM2 globally
RUN npm install -g pm2

RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Create PM2 ecosystem config
RUN echo 'module.exports = { \
  apps: [{ \
    name: "nextjs", \
    script: "server.js", \
    instances: 1, \
    exec_mode: "fork", \
    env: { \
      NODE_ENV: "production", \
      PORT: 3000 \
    }, \
    error_file: "/tmp/pm2-error.log", \
    out_file: "/tmp/pm2-out.log", \
    log_date_format: "YYYY-MM-DD HH:mm:ss Z" \
  }] \
};' > ecosystem.config.js

USER nextjs
EXPOSE 3000
ENV PORT=3000
CMD ["pm2-runtime", "start", "ecosystem.config.js"]
