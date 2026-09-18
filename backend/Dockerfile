FROM node:24-alpine

WORKDIR /app

ENV TZ=Asia/Tokyo
RUN apk add --no-cache tzdata

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# EC2 ではこのイメージから `npm run db:migrate`（drizzle-kit migrate）を流す（infra/README.md）。
# drizzle-kit は devDependencies だが、上の npm ci は NODE_ENV 未設定なので入っている。
# build の後に置き、マイグレーションを足しただけで上の層のキャッシュを壊さない。
# 開発時は ./backend を bind mount するので、ここで COPY した中身は見えない。
COPY drizzle ./drizzle
COPY drizzle.config.ts ./

# 開発時はバインドマウント越しにホストへ書き出すため、
# ホストのユーザーと同じ uid/gid の node（1000:1000）で動かす。
RUN chown -R node:node /app
USER node

EXPOSE 3000
CMD ["node", "dist/index.js"]
