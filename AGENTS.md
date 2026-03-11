# AGENTS.md

**Project:** Media Library Analyzer
**Repository Type:** Open-source self-hosted media analysis tool
**Primary Goal:** Analyze large video media collections using `ffprobe`, store normalized metadata in SQLite, and provide a performant web interface with detailed technical statistics.

---

# 1. Project Overview

The **Media Library Analyzer** is a self-hosted application designed to scan and analyze large collections of video files.

It focuses strictly on **technical media analysis**, not media playback or metadata scraping.

The application:

* scans directories defined by the user as **Libraries**
* analyzes media files using **ffprobe**
* stores structured data in **SQLite**
* provides a **web interface with statistics and filtering**
* runs entirely inside **one Docker container**
* supports collections with **100k+ media files**

The system must be designed for **high performance, scalability, and extensibility**.

---

# 2. Key Principles

### 2.1 Core Design Goals

* high performance
* scalable to large libraries
* deterministic scans
* incremental scanning
* strong normalization of media metadata
* minimal dependencies
* fully self-hosted
* docker-native deployment

### 2.2 Non-Goals (for v1)

The system does **not**:

* play media
* scrape movie metadata
* connect to external APIs
* modify media files
* integrate with media servers

---

# 3. Core Features (v1)

### 3.1 Libraries

Users can create libraries representing a directory.

Each library has:

* name
* filesystem path
* library type
* scan configuration

Library types:

```
movies
series
mixed
other
```

Only libraries of type **series** enable episode detection logic.

---

### 3.2 File Scanning

The scanner must:

1. recursively traverse library directories
2. detect media files
3. store file metadata
4. run ffprobe analysis for new or modified files
5. update database records

File change detection uses:

* path
* file size
* modification time

Optional later:

* file hash

---

### 3.3 Media Analysis

Every video file is analyzed with:

```
ffprobe -v quiet -print_format json -show_format -show_streams -show_chapters
```

The JSON output is parsed and normalized into database tables.

---

### 3.4 Stream Detection

The system must detect:

Video Streams:

* codec
* resolution
* bitrate
* frame rate
* color space
* HDR type

Audio Streams:

* codec
* channels
* channel layout
* sample rate
* language
* bitrate

Subtitle Streams:

* codec
* language
* forced flag
* default flag
* text/image type

---

### 3.5 External Subtitle Detection

The system must detect external subtitles next to video files.

Examples:

```
movie.de.srt
movie.en.ass
movie.forced.srt
```

Supported formats:

```
srt
ass
ssa
sub
idx
```

---

### 3.6 Statistics

The system must compute statistics including:

Video:

* codec distribution
* resolution distribution
* HDR vs SDR
* frame rate distribution

Audio:

* codec distribution
* channel layout distribution
* language distribution

Subtitles:

* language distribution
* internal vs external

Library:

* total files
* total duration
* total storage
* bitrate distribution

---

### 3.7 File Quality Score

Each media file receives a **quality score from 1 to 10**.

Score factors include:

Video codec
resolution
bitrate efficiency
HDR presence
audio channels
audio codec

Example scoring logic:

| Feature                        | Score Impact |
| ------------------------------ | ------------ |
| AV1 / HEVC                     | +2           |
| H264                           | +1           |
| 4K                             | +2           |
| 1080p                          | +1           |
| HDR                            | +1           |
| 7.1 audio                      | +2           |
| 5.1 audio                      | +1           |
| very high bitrate inefficiency | -2           |

The final score is normalized to **1–10**.

---

# 4. Performance Requirements

The system must handle:

```
100,000+ media files
```

Performance requirements:

* scanning must support parallel workers
* database writes must be batched
* ffprobe must run with configurable worker count
* database must use WAL mode
* indices must exist for all filterable fields

---

# 5. Technology Stack

Backend:

```
Python
FastAPI
SQLAlchemy
SQLite
```

Worker System:

```
async worker queue
APScheduler for scheduled scans
```

Frontend:

```
React + Vite
```

Media analysis:

```
ffprobe
```

Container:

```
Docker
```

---

# 6. System Architecture

Single container architecture.

Internal components:

```
Web API
Scanner Worker
Job Queue
SQLite Database
Frontend
```

---

# 7. Docker Requirements

Container must include:

```
ffmpeg
ffprobe
python runtime
sqlite
node build tools
```

Expected runtime configuration:

```
/config
/media
```

Example container layout:

```
/app
/config
/media
```

---

# 8. Docker Usage

Example docker compose:

```
services:
  media-analyzer:
    image: media-analyzer
    ports:
      - "8080:8080"
    volumes:
      - /path/to/config:/config
      - /path/to/media:/media
    environment:
      - CONFIG_PATH=/config
      - MEDIA_ROOT=/media
```

Important rule:

The UI must **only allow browsing paths under MEDIA_ROOT**.

---

# 9. Database Schema

## libraries

```
id
name
path
type
created_at
updated_at
last_scan_at
scan_mode
```

---

## media_files

```
id
library_id
relative_path
filename
extension
size_bytes
mtime
last_seen_at
last_analyzed_at
scan_status
quality_score
```

---

## media_formats

```
id
media_file_id
container_format
duration
bit_rate
probe_score
```

---

## video_streams

```
id
media_file_id
stream_index
codec
profile
width
height
pix_fmt
color_space
color_transfer
color_primaries
frame_rate
bit_rate
hdr_type
```

---

## audio_streams

```
id
media_file_id
stream_index
codec
channels
channel_layout
sample_rate
bit_rate
language
default_flag
forced_flag
```

---

## subtitle_streams

```
id
media_file_id
stream_index
codec
language
default_flag
forced_flag
```

---

## external_subtitles

```
id
media_file_id
path
language
format
```

---

## scan_jobs

```
id
library_id
status
job_type
files_total
files_scanned
errors
started_at
finished_at
```

---

# 10. Scanning Strategy

Two scan types:

### Full Scan

Used for first library analysis.

Steps:

1 traverse filesystem
2 record files
3 analyze files

---

### Incremental Scan

Detects:

* new files
* modified files
* deleted files

Only changed files run ffprobe.

---

# 11. Optional Watch Mode

Libraries can enable file watching.

Implementation:

```
watchdog
```

Used only if explicitly enabled.

---

# 12. Supported Media Formats

Video containers:

```
mkv
mp4
avi
mov
m4v
ts
m2ts
wmv
```

Subtitles:

```
srt
ass
ssa
sub
idx
```

---

# 13. Web Interface

Main UI pages:

### Dashboard

Displays:

* total files
* total storage
* codec distribution
* HDR distribution
* resolution distribution

---

### Libraries Page

Displays:

* all libraries
* file counts
* storage usage
* scan status

---

### Library Detail Page

Includes:

* charts
* file table
* scan controls

---

### File Table

Columns:

```
filename
size
duration
codec
resolution
hdr
audio languages
subtitle languages
quality score
```

Supports filtering.

---

### File Detail Page

Displays:

* video streams
* audio streams
* subtitle streams
* raw ffprobe JSON

---

# 14. Internationalization

The application must support multiple languages.

Default language:

```
English
```

Architecture must allow easy addition of languages.

Recommended library:

```
i18next
```

Translations stored in:

```
/frontend/locales/
```

---

# 15. Security Model

No built-in user management in v1.

Deployment assumes:

* internal network usage
  or
* reverse proxy authentication.

---

# 16. File System Safety

Media directories must be mounted **read-only**.

The application must not modify files in v1.

---

# 17. Future Features (v2+)

Possible future expansions:

Transcode candidate detection

Automatic renaming based on metadata

Media deduplication

JSON / CSV exports

Jellyfin integration

Media quality recommendations

---

# 18. Repository Structure

```
MediaLyze/

backend/
frontend/
scanner/
db/
workers/
docker/
tests/
docs/

AGENTS.md
README.md
docker-compose.yml
```

---

# 19. Coding Guidelines

General rules:

* strict typing
* clear modular structure
* no monolithic modules
* comprehensive logging
* defensive parsing of ffprobe output

---

# 20. Open Source Requirements

License:

```
MIT
```

Repository must include:

```
README
LICENSE
CONTRIBUTING
```

---

# 21. Development Priority

Implementation order:

1. Database models
2. Scanner engine
3. ffprobe parser
4. API endpoints
5. Worker queue
6. Statistics system
7. Frontend UI
8. Docker packaging
9. database migration logic (for future changes)

---

# 22. Success Criteria

The project is considered functional when it can:

* create libraries
* scan directories
* analyze media with ffprobe
* store normalized metadata
* display statistics
* handle collections of 100k files
* run fully in Docker

---
