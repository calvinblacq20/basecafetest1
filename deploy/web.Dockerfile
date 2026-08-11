ARG APP_NAME=pos-web
FROM node:22-alpine AS build
ARG APP_NAME
ARG NEXT_PUBLIC_API_BASE_URL
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
WORKDIR /workspace
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @base-cafe/${APP_NAME} build

FROM node:22-alpine AS runtime
ARG APP_NAME
ENV NODE_ENV=production
ENV APP_NAME=$APP_NAME
WORKDIR /workspace
RUN corepack enable
RUN addgroup -S basecafe && adduser -S basecafe -G basecafe
COPY --from=build /workspace ./
USER basecafe
CMD ["sh", "-c", "cd apps/${APP_NAME} && node node_modules/next/dist/bin/next start -p 3000"]
