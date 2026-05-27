FROM node:20-alpine

RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

WORKDIR /app

COPY package.json ./
RUN pnpm install

COPY . .

EXPOSE 5173

CMD ["pnpm", "dev"]
