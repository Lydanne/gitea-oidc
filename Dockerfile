FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json pnpm-lock.yaml ./

RUN npm install -g pnpm && pnpm install --frozen-lockfile

COPY . .

RUN pnpm run build:prod

FROM node:22-alpine AS runner

WORKDIR /app

COPY --from=builder /app/dist ./dist

COPY --from=builder /app/package.json ./

COPY --from=builder /app/public ./public

COPY --from=builder /app/node_modules ./node_modules

EXPOSE 3000

CMD ["node", "dist/server.js"]
