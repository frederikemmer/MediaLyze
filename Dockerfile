FROM node:24-alpine AS frontend-build
ARG APP_VERSION=dev
ENV VITE_APP_VERSION=${APP_VERSION}
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./frontend/
WORKDIR /app/frontend
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.12-alpine AS runtime
ARG APP_VERSION=0.7.1

LABEL name="MediaLyze"
LABEL org.opencontainers.image.source="https://github.com/frederikemmer/MediaLyze"
LABEL org.opencontainers.image.version="${APP_VERSION}"

ENV APP_VERSION=${APP_VERSION}
ENV APP_PORT=8080
ENV CONFIG_PATH=/config
ENV MEDIA_ROOT=/media
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

RUN apk add --no-cache ffmpeg su-exec tzdata

COPY pyproject.toml README.md LICENSE CONTRIBUTING.md ./
COPY backend ./backend
COPY docker/entrypoint.sh /usr/local/bin/docker-entrypoint.sh
COPY frontend/package.json ./frontend/package.json
COPY --from=frontend-build /app/frontend/dist ./frontend/dist

RUN pip install --no-cache-dir .
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 8080

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["sh", "-c", "uvicorn backend.app.main:app --host 0.0.0.0 --port ${APP_PORT}"]
