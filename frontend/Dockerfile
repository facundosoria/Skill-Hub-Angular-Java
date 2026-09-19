# syntax=docker/dockerfile:1

# --- build ---------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# --- runtime ----------------------------------------------------------
# Caddy sirve el bundle estatico y hace de reverse-proxy de /api -> backend.
FROM caddy:2-alpine AS runtime
COPY --from=build /app/dist/skill-hub-web/browser /srv
COPY Caddyfile /etc/caddy/Caddyfile
# Correr como non-root. Puerto 8080 para evitar bind a :80 sin permisos.
RUN adduser -D -u 1001 caddy \
 && chown -R caddy:caddy /srv /etc/caddy /data /config
USER caddy
EXPOSE 8080
