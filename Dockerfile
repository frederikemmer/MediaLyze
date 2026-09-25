# syntax=docker/dockerfile:1

FROM --platform=$BUILDPLATFORM node:24-alpine AS frontend-build
ARG APP_VERSION=dev
ENV VITE_APP_VERSION=${APP_VERSION}
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./frontend/
COPY CHANGELOG.md ./CHANGELOG.md
WORKDIR /app/frontend
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM --platform=$BUILDPLATFORM python:3.12-alpine AS backend-build
WORKDIR /build
COPY pyproject.toml README.md LICENSE CONTRIBUTING.md ./
COPY backend ./backend
RUN pip wheel --no-cache-dir --no-deps --wheel-dir /wheels .

FROM python:3.12-alpine AS runtime
ARG APP_VERSION=0.18.1

LABEL name="MediaLyze"
LABEL org.opencontainers.image.source="https://github.com/frederikemmer/MediaLyze"

ENV APP_PORT=8080
ENV CONFIG_PATH=/config
ENV MEDIA_ROOT=/media
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

RUN apk add --no-cache ffmpeg su-exec tzdata

COPY pyproject.toml ./
RUN python -c 'import tomllib; print("\n".join(tomllib.load(open("pyproject.toml", "rb"))["project"]["dependencies"]))' \
    > /tmp/runtime-requirements.txt \
    && pip install --no-cache-dir -r /tmp/runtime-requirements.txt \
    && rm /tmp/runtime-requirements.txt

COPY README.md LICENSE CONTRIBUTING.md ./
COPY backend ./backend
COPY docker/entrypoint.sh /usr/local/bin/docker-entrypoint.sh
COPY frontend/package.json ./frontend/package.json
COPY --from=frontend-build /app/frontend/dist ./frontend/dist
COPY --from=backend-build /wheels /tmp/medialyze-wheels

RUN pip install --no-cache-dir --no-deps /tmp/medialyze-wheels/*.whl \
    && rm -rf /tmp/medialyze-wheels \
    && chmod +x /usr/local/bin/docker-entrypoint.sh

ENV APP_VERSION=${APP_VERSION}
LABEL org.opencontainers.image.version="${APP_VERSION}"
RUN printf '%s\n' "${APP_VERSION}" > /app/.medialyze-version

EXPOSE 8080

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["sh", "-c", "uvicorn backend.app.main:app --host 0.0.0.0 --port ${APP_PORT}"]
