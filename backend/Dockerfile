FROM node:24-alpine

WORKDIR /app

ENV TZ=Asia/Tokyo
RUN apk add --no-cache tzdata

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

EXPOSE 3000
CMD ["node", "dist/index.js"]
