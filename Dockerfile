ARG APP_VERSION=0.1.0

FROM node:24-bookworm-slim AS frontend-build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim-bookworm AS runtime
ARG APP_VERSION=0.1.0

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

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg tzdata \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml README.md LICENSE CONTRIBUTING.md ./
COPY backend ./backend
COPY alembic ./alembic
COPY frontend/package.json ./frontend/package.json
COPY --from=frontend-build /app/frontend/dist ./frontend/dist

RUN pip install --no-cache-dir .

EXPOSE 8080

CMD ["sh", "-c", "uvicorn backend.app.main:app --host 0.0.0.0 --port ${APP_PORT}"]
