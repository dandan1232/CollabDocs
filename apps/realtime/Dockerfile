FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

FROM base AS builder
WORKDIR /workspace
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @collabdocs/db build && pnpm --filter @collabdocs/realtime build

FROM base AS production-dependencies
WORKDIR /workspace
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/realtime/package.json apps/realtime/package.json
COPY packages/db/package.json packages/db/package.json
RUN pnpm install --frozen-lockfile --prod --filter @collabdocs/realtime

FROM node:22-alpine AS runner
ENV NODE_ENV=production
ENV REALTIME_PORT=1234
WORKDIR /app/apps/realtime
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 collabdocs
COPY --from=production-dependencies --chown=collabdocs:nodejs /workspace/node_modules /app/node_modules
COPY --from=production-dependencies --chown=collabdocs:nodejs /workspace/apps/realtime/node_modules ./node_modules
COPY --from=production-dependencies --chown=collabdocs:nodejs /workspace/packages/db/node_modules /app/packages/db/node_modules
COPY --from=builder --chown=collabdocs:nodejs /workspace/apps/realtime/dist ./dist
COPY --from=builder --chown=collabdocs:nodejs /workspace/packages/db/dist /app/packages/db/dist
COPY --from=builder --chown=collabdocs:nodejs /workspace/packages/db/package.json /app/packages/db/package.json
USER collabdocs
EXPOSE 1234
CMD ["node", "dist/server.js"]
