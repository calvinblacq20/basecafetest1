FROM node:22-alpine AS build
WORKDIR /workspace
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/api apps/api
COPY packages packages
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @base-cafe/database generate
RUN pnpm --filter @base-cafe/contracts build
RUN pnpm --filter @base-cafe/database build
RUN pnpm --filter @base-cafe/api build

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /workspace
RUN corepack enable
RUN addgroup -S basecafe && adduser -S basecafe -G basecafe
COPY --from=build /workspace/node_modules ./node_modules
COPY --from=build /workspace/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /workspace/packages ./packages
COPY --from=build /workspace/apps/api/dist ./apps/api/dist
COPY apps/api/package.json ./apps/api/package.json
USER basecafe
EXPOSE 3100
CMD ["node", "apps/api/dist/main.js"]
