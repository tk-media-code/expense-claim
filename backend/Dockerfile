FROM node:24-alpine

WORKDIR /app

ENV TZ=Asia/Tokyo
RUN apk add --no-cache tzdata

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# 開発時はバインドマウント越しにホストへ書き出すため、
# ホストのユーザーと同じ uid/gid の node（1000:1000）で動かす。
RUN chown -R node:node /app
USER node

EXPOSE 3000
CMD ["node", "dist/index.js"]
