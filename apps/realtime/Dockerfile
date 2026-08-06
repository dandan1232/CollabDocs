FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

FROM base AS builder
WORKDIR /workspace
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @collabdocs/realtime build

FROM node:22-alpine AS runner
ENV NODE_ENV=production
ENV REALTIME_PORT=1234
WORKDIR /app
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 collabdocs
COPY --from=builder --chown=collabdocs:nodejs /workspace/apps/realtime/dist ./dist
USER collabdocs
EXPOSE 1234
CMD ["node", "dist/server.js"]
