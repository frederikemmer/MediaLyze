import "../i18n";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";

import {
  api,
  type FileTranscode,
  type MediaFileDetail,
  type TranscodeCapabilities,
  type TranscodeJob,
  type TranscodePlan,
  type TranscodeProfilePlan,
  type TranscodeValidation,
} from "../lib/api";
import { TranscodingPanel } from "./TranscodingPanel";

const compatibilityPlan: TranscodePlan = {
  version: 1,
  profile: "compatibility",
  container: "mp4",
  video_streams: [{ stream_index: 0, action: "encode", codec: "h264", encoder: "libx264", crf: 20, width: 1920, height: 1080 }],
  audio_streams: [{ stream_index: 1, action: "encode", codec: "aac", encoder: "aac", bitrate: 192000 }],
  subtitle_streams: [{ stream_index: 2, action: "encode", codec: "mov_text", encoder: "mov_text" }],
  external_subtitles: [],
  dynamic_range: "preserve",
  chapters: "keep",
  metadata: "keep",
  cover: "keep",
  attachments: "keep",
  filename_template: "[{resolution}, {dynRange}, {codec}] [{audioLanguages}]",
};

const file = {
  id: 1,
  filename: "Movie.mkv",
  video_streams: [{ stream_index: 0, codec: "hevc", width: 3840, height: 2160 }],
  audio_streams: [{ stream_index: 1, codec: "aac", language: "en", channels: 2, default_flag: true }],
  subtitle_streams: [{ stream_index: 2, codec: "subrip", language: "de", default_flag: true, forced_flag: false, subtitle_type: "text" }],
  external_subtitles: [{ id: 8, path: "Movie.en.srt", language: "en", format: "srt" }],
  raw_ffprobe_json: { format: { format_name: "matroska" } },
} as unknown as MediaFileDetail;

const capabilities: TranscodeCapabilities = {
  ffmpeg_available: true,
  ffmpeg_path: "ffmpeg",
  version: "ffmpeg version test",
  containers: ["mkv", "mp4", "webm"],
  encoders: [
    { name: "libx264", codec: "h264", hardware: false, available: true, tested: false, test_error: null, options: ["crf", "preset", "profile"] },
    { name: "h264_nvenc", codec: "h264", hardware: true, available: true, tested: true, test_error: null, options: ["cq", "preset"] },
    { name: "av1_qsv", codec: "av1", hardware: true, available: true, tested: true, test_error: null, options: ["global_quality", "preset"] },
    { name: "aac", codec: "aac", hardware: false, available: true, tested: false, test_error: null, options: [] },
    { name: "mov_text", codec: "mov_text", hardware: false, available: true, tested: false, test_error: null, options: [] },
  ],
  dolby_vision_passthrough: true,
  error: null,
};

function job(overrides: Partial<TranscodeJob> = {}): TranscodeJob {
  return {
    id: 5,
    group_id: 3,
    library_id: 1,
    source_file_id: 1,
    result_file_id: null,
    status: "queued",
    profile: "compatibility",
    plan_version: 1,
    plan: compatibilityPlan,
    ffmpeg_arguments: ["ffmpeg", "-map", "0:0"],
    ffmpeg_command: "ffmpeg -map 0:0 output.mp4",
    warnings: [],
    source_path_snapshot: "C:/media/Movie.mkv",
    output_path_snapshot: "C:/media/Movie [1080p].mp4",
    output_relative_path: "Movie [1080p].mp4",
    progress_percent: 25,
    processed_seconds: 30,
    speed: "2.0x",
    eta_seconds: 45,
    error: null,
    created_at: "2026-09-01T10:00:00Z",
    updated_at: "2026-09-01T10:00:00Z",
    started_at: null,
    finished_at: null,
    ...overrides,
  };
}

const payload: FileTranscode = {
  original: {
    id: 1,
    filename: "Movie.mkv",
    relative_path: "Movie.mkv",
    size_bytes: 10_000,
    duration_seconds: 120,
    width: 3840,
    height: 2160,
    dynamic_range: "HDR10",
    video_codec: "hevc",
    audio_codecs: ["aac"],
    audio_languages: ["en"],
  },
  profiles: {
    compatibility: compatibilityPlan,
    storage: { ...compatibilityPlan, profile: "storage", container: "mkv" },
    modern: { ...compatibilityPlan, profile: "modern", container: "mkv" },
  },
  attachments: [{ stream_index: 4, codec: "ttf", filename: "Poster Font.ttf", mimetype: "application/x-truetype-font", title: null }],
  variants: [{
    id: 7,
    group_id: 3,
    job_id: 4,
    original_file_id: 1,
    output_file_id: 2,
    library_root_id: 1,
    output_relative_path: "Movie [1080p].mp4",
    output_filename: "Movie [1080p].mp4",
    source_path_snapshot: "C:/media/Movie.mkv",
    output_path_snapshot: "C:/media/Movie [1080p].mp4",
    analysis_status: "ready",
    created_at: "2026-09-01T10:00:00Z",
    updated_at: "2026-09-01T10:05:00Z",
    file: { id: 2, filename: "Movie [1080p].mp4", relative_path: "Movie [1080p].mp4", size_bytes: 8000, duration_seconds: 120, width: 1920, height: 1080, dynamic_range: "SDR", video_codec: "h264", audio_codecs: ["aac"], audio_languages: ["en"] },
  }],
  jobs: [job({ id: 4, status: "completed", result_file_id: 2, progress_percent: 100, finished_at: "2026-09-01T10:05:00Z" })],
};

const validation: TranscodeValidation = {
  valid: true,
  output_path: "C:/media/Movie [1920x1080, HDR10, H264] [en].mp4",
  output_filename: "Movie [1920x1080, HDR10, H264] [en].mp4",
  normalized_plan: compatibilityPlan,
  ffmpeg_arguments: ["ffmpeg", "-map", "0:0", "output.mp4"],
  ffmpeg_command: "ffmpeg -map 0:0 output.mp4",
  kept_streams: [],
  changed_streams: ["video stream 0", "audio stream 1"],
  removed_streams: [],
  added_streams: [],
  warnings: ["test warning"],
  errors: [],
  detected_hardware_encoders: ["h264_nvenc"],
};

const savedProfile: TranscodeProfilePlan = {
  profile: {
    id: 9,
    name: "Archive profile",
    description: "A saved profile for archive files.",
    version: 2,
    is_builtin: false,
    builtin_key: null,
    definition: {
      version: 1,
      container: "mkv",
      video_rules: [],
      audio_rules: [],
      subtitle_rules: [],
      external_subtitle_rules: [],
      default_video_action: "copy",
      default_audio_action: "copy",
      default_subtitle_action: "copy",
      default_external_subtitle_action: "remove",
      dynamic_range: "preserve",
      chapters: "keep",
      metadata: "keep",
      cover: "keep",
      attachments: "keep",
      filename_template: "[{resolution}]",
      filename_template_override: true,
      include_subtitle_languages: false,
      execution_mode: "inherit",
    },
    used_by_rule_count: 0,
    created_at: "2026-09-01T09:00:00Z",
    updated_at: "2026-09-01T09:00:00Z",
  },
  plan: { ...compatibilityPlan, profile: "expert", container: "mkv", filename_template: "[{resolution}]", filename_template_override: true },
};

describe("TranscodingPanel", () => {
  beforeEach(() => {
    vi.spyOn(api, "fileTranscode").mockResolvedValue(payload);
    vi.spyOn(api, "transcodeCapabilities").mockResolvedValue(capabilities);
    vi.spyOn(api, "validateFileTranscode").mockResolvedValue(validation);
    vi.spyOn(api, "startFileTranscode").mockResolvedValue(job());
    vi.spyOn(api, "cancelTranscodeJob").mockResolvedValue(job({ status: "canceled", finished_at: "2026-09-01T10:01:00Z" }));
    vi.spyOn(api, "transcodeJob").mockResolvedValue(job());
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("edits structured stream fields and exposes the synchronized preview path", async () => {
    render(<MemoryRouter><TranscodingPanel file={file} /></MemoryRouter>);

    expect((await screen.findAllByText("Movie.mkv")).length).toBeGreaterThan(0);
    expect(screen.getByRole("combobox", { name: "Action for stream 0" })).toHaveValue("encode");
    expect(screen.getByRole("combobox", { name: "Action for stream 0" })).toHaveClass("settings-choice-input", "transcode-control");
    expect(screen.getByRole("slider", { name: "video 0 quality" })).toHaveClass("settings-choice-input", "transcode-control");
    expect(screen.getByRole("combobox", { name: "video 0 speed preset" })).toHaveValue("medium");
    expect(screen.getByRole("combobox", { name: "video 0 resolution" })).toHaveClass("settings-choice-input", "transcode-control");
    expect(screen.queryByRole("textbox", { name: "video 0 codec" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Locally reported encoder options/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "video 0 encoder" }), { target: { value: "av1_qsv" } });
    expect(screen.getByRole("combobox", { name: "video 0 speed preset" })).toHaveValue("medium");
    fireEvent.change(screen.getByRole("combobox", { name: "video 0 speed preset" }), { target: { value: "slow" } });
    fireEvent.change(screen.getByRole("combobox", { name: "video 0 resolution" }), { target: { value: "1280x720" } });
    fireEvent.click(screen.getByText("Subtitle streams"));
    fireEvent.change(screen.getByRole("combobox", { name: "Action for stream 2" }), { target: { value: "drop" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /Movie\.en\.srt/ }));
    fireEvent.click(screen.getByRole("button", { name: "Validate plan" }));

    expect((await screen.findAllByText(validation.output_filename)).length).toBeGreaterThan(0);
    expect(screen.getByText("video stream 0, audio stream 1")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Generated FFmpeg command"));
    expect(screen.getAllByText(validation.ffmpeg_command).length).toBeGreaterThan(0);
    expect(screen.getByText(/Poster Font\.ttf/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open synchronized preview" })).toHaveAttribute("href", "/files/1/preview?compare=2");
    expect(screen.getByText("Full transcoding plan")).toBeInTheDocument();

    const sentPlan = vi.mocked(api.validateFileTranscode).mock.calls[0][1];
    expect(sentPlan.video_streams[0].width).toBe(1280);
    expect(sentPlan.video_streams[0].preset).toBe("slow");
    expect(sentPlan.subtitle_streams[0].action).toBe("drop");
    expect(sentPlan.external_subtitles[0]).toMatchObject({ subtitle_id: 8, action: "encode" });
  });

  it("starts a validated job, shows progress, and cancels it", async () => {
    render(<MemoryRouter><TranscodingPanel file={file} /></MemoryRouter>);
    await screen.findAllByText("Movie.mkv");
    fireEvent.click(screen.getByRole("button", { name: "Start transcoding" }));

    expect(await screen.findByText("25%")).toBeInTheDocument();
    expect(screen.getByText(/2.0x/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(api.cancelTranscodeJob).toHaveBeenCalledWith(5));
  });

  it("previews the generated filename and supports subtitle-language templates", async () => {
    render(<MemoryRouter><TranscodingPanel file={file} /></MemoryRouter>);
    await screen.findAllByText("Movie.mkv");

    expect(screen.getByText("Movie [1920x1080, HDR10, H264] [en].mp4")).toBeInTheDocument();
    const subtitleOption = screen.getByRole("checkbox", { name: "Include subtitle languages" });
    const overrideOption = screen.getByRole("checkbox", { name: "Override default template" });
    expect(subtitleOption).not.toBeChecked();
    expect(overrideOption).not.toBeChecked();

    fireEvent.click(subtitleOption);
    expect(screen.getByRole("textbox", { name: "Filename template" })).toHaveValue("[{resolution}, {dynRange}, {codec}] [{audioLanguages}] [{subtitleLanguages}]");
    expect(screen.getByText("Movie [1920x1080, HDR10, H264] [en] [de].mp4")).toBeInTheDocument();

    fireEvent.click(overrideOption);
    const templateInput = screen.getByRole("textbox", { name: "Filename template" });
    expect(templateInput).not.toBeDisabled();
    fireEvent.change(templateInput, { target: { value: "[{codec}] [{subtitleLanguages}]" } });
    expect(screen.getByText("Movie [H264] [de].mp4")).toBeInTheDocument();
  });

  it("applies a saved profile and switches back to expert editing", async () => {
    vi.mocked(api.fileTranscode).mockResolvedValue({ ...payload, saved_profiles: [savedProfile] });
    render(<MemoryRouter><TranscodingPanel file={file} /></MemoryRouter>);
    await screen.findAllByText("Movie.mkv");

    const profileSelect = screen.getByRole("combobox", { name: "Profile" });
    fireEvent.change(profileSelect, { target: { value: "saved:9" } });
    expect(profileSelect).toHaveValue("saved:9");
    expect(screen.getByRole("combobox", { name: "Target container" })).toHaveValue("mkv");

    fireEvent.change(screen.getByRole("combobox", { name: "Target container" }), { target: { value: "mp4" } });
    expect(profileSelect).toHaveValue("expert");
  });
});
