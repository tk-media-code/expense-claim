FROM node:24-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# バインドマウント越しにホストへ root 所有のファイルを書き出さないため、
# ホストのユーザーと同じ uid/gid の node（1000:1000）で動かす。
RUN chown -R node:node /app
USER node

EXPOSE 3000
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
