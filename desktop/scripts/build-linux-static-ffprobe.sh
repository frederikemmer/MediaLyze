#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "build-linux-static-ffprobe.sh must run on Linux." >&2
  exit 1
fi

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd)"
BUILD_ROOT="${RUNNER_TEMP:-$REPO_ROOT/dist}/medialyze-ffprobe-build"
OUTPUT_DIR="$REPO_ROOT/dist/ffprobe-bundle"

FFMPEG_VERSION="7.1.1"
FFMPEG_TARBALL="ffmpeg-${FFMPEG_VERSION}.tar.xz"
FFMPEG_URL="https://ffmpeg.org/releases/${FFMPEG_TARBALL}"
FFMPEG_SHA256="733984395e0dbbe5c046abda2dc49a5544e7e0e1e2366bba849222ae9e3a03b1"

rm -rf "$BUILD_ROOT"
mkdir -p "$BUILD_ROOT" "$OUTPUT_DIR"

cd "$BUILD_ROOT"
curl -fsSLO "$FFMPEG_URL"
printf '%s  %s\n' "$FFMPEG_SHA256" "$FFMPEG_TARBALL" | sha256sum -c -
tar -xf "$FFMPEG_TARBALL"

cd "ffmpeg-${FFMPEG_VERSION}"
CC=musl-gcc ./configure \
  --cc=musl-gcc \
  --extra-ldflags="-static" \
  --disable-shared \
  --enable-static \
  --disable-autodetect \
  --disable-doc \
  --disable-debug \
  --disable-programs \
  --enable-ffprobe \
  --disable-ffmpeg \
  --disable-ffplay \
  --disable-network

make -j"$(nproc)" ffprobe
cp ffprobe "$OUTPUT_DIR/ffprobe"
chmod +x "$OUTPUT_DIR/ffprobe"

"$OUTPUT_DIR/ffprobe" -version >/dev/null
if readelf -d "$OUTPUT_DIR/ffprobe" | grep -q "(NEEDED)"; then
  echo "Expected static ffprobe, but readelf reported dynamic NEEDED entries." >&2
  readelf -d "$OUTPUT_DIR/ffprobe" >&2
  exit 1
fi

