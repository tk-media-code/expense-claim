FROM node:24-alpine AS frontend

WORKDIR /app

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run generate

FROM nginx:stable-alpine

COPY --from=frontend /app/.output/public /usr/share/nginx/html
COPY nginx/default.conf /etc/nginx/conf.d/default.conf
