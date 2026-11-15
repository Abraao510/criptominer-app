FROM node:22-bookworm-slim AS build

WORKDIR /app
RUN npm install --global pnpm@11.25.0

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

FROM node:22-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production
RUN npm install --global pnpm@11.25.0

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY server.ts tsconfig.node.json ./

EXPOSE 3000
CMD ["pnpm", "start"]
