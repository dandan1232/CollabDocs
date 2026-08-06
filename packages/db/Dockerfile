FROM node:22-alpine AS runner

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable

WORKDIR /workspace

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/db/package.json packages/db/package.json
RUN pnpm install --frozen-lockfile --filter @collabdocs/db...

COPY tsconfig.base.json ./
COPY packages/db packages/db

WORKDIR /workspace/packages/db

CMD ["pnpm", "db:migrate:deploy"]
