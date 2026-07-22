FROM node:20-alpine AS base

FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
# Ship the Prisma CLI + engines so `prisma migrate deploy` runs offline at
# startup (the standalone trace omits them, which would force a slow/fragile
# runtime download on hosts like Scalingo).
COPY --from=builder /app/node_modules/prisma ./node_modules/prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
USER nextjs
EXPOSE 3000
# Default for local/Docker Compose; managed platforms (e.g. Scalingo) inject
# their own PORT which overrides this and the standalone server honours it.
ENV PORT=3000
CMD ["sh", "-c", "npx prisma migrate deploy && node server.js"]
