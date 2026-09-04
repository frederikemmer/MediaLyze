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

FROM --platform=$BUILDPLATFORM python:3.12-slim-bookworm AS backend-build
WORKDIR /build
COPY pyproject.toml README.md LICENSE CONTRIBUTING.md ./
COPY backend ./backend
RUN pip wheel --no-cache-dir --no-deps --wheel-dir /wheels .

FROM python:3.12-slim-bookworm AS runtime
ARG APP_VERSION=0.18.0
ARG TARGETARCH
ARG FFMPEG_PACKAGE_VERSION=7:5.1.9-0+deb12u1
ARG FFMPEG_PACKAGE_SHA256_AMD64=2ba8ead87657c123ce6de2de5ecdbc1fb4ead9a4b317b85b8ec41e16c890fe01
ARG FFMPEG_PACKAGE_SHA256_ARM64=7890aeb19a94d73e5d9281afa5ca07005804c1fca4f10791f4f2ce0df741b610

LABEL name="MediaLyze"
LABEL org.opencontainers.image.source="https://github.com/frederikemmer/MediaLyze"

ENV APP_PORT=8080
ENV CONFIG_PATH=/config
ENV MEDIA_ROOT=/media
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

RUN set -eux; \
    case "${TARGETARCH}" in \
        amd64|"") debian_arch="amd64"; expected_ffmpeg_sha256="${FFMPEG_PACKAGE_SHA256_AMD64}" ;; \
        arm64) debian_arch="arm64"; expected_ffmpeg_sha256="${FFMPEG_PACKAGE_SHA256_ARM64}" ;; \
        *) echo "Unsupported target architecture: ${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    apt-get update; \
    cd /tmp; \
    apt-get download "ffmpeg=${FFMPEG_PACKAGE_VERSION}"; \
    ffmpeg_package="$(find /tmp -maxdepth 1 -type f -name 'ffmpeg_*.deb' -print -quit)"; \
    test -n "${ffmpeg_package}"; \
    test "$(dpkg-deb -f "${ffmpeg_package}" Architecture)" = "${debian_arch}"; \
    test "$(dpkg-deb -f "${ffmpeg_package}" Version)" = "${FFMPEG_PACKAGE_VERSION}"; \
    printf '%s  %s\n' "${expected_ffmpeg_sha256}" "${ffmpeg_package}" | sha256sum -c -; \
    vaapi_packages="mesa-va-drivers"; \
    if [ "${debian_arch}" = "amd64" ]; then \
        vaapi_packages="${vaapi_packages} intel-media-va-driver i965-va-driver"; \
    fi; \
    apt-get install -y --no-install-recommends "${ffmpeg_package}" ca-certificates gosu tzdata ${vaapi_packages}; \
    rm -f "${ffmpeg_package}"; \
    rm -rf /var/lib/apt/lists/*

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
    && sed -i 's/\r$//' /usr/local/bin/docker-entrypoint.sh \
    && chmod +x /usr/local/bin/docker-entrypoint.sh

ENV APP_VERSION=${APP_VERSION}
LABEL org.opencontainers.image.version="${APP_VERSION}"
RUN printf '%s\n' "${APP_VERSION}" > /app/.medialyze-version

EXPOSE 8080

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["sh", "-c", "uvicorn backend.app.main:app --host 0.0.0.0 --port ${APP_PORT}"]
