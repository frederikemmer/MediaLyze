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
import { FileTranscodeHistory, TranscodingPanel } from "./TranscodingPanel";

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

  it("edits structured stream fields without rendering a separate variant section", async () => {
    render(<MemoryRouter><TranscodingPanel file={file} /></MemoryRouter>);

    expect((await screen.findAllByText("Movie.mkv")).length).toBeGreaterThan(0);
    expect(screen.queryByRole("heading", { name: "Linked variants" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Transcoding history" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("tab")).toHaveLength(3);
    expect(screen.getByRole("tab", { name: /Video/ })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("tab", { name: /Audio/ }));
    expect(screen.getByRole("combobox", { name: "Action for stream 1" })).toHaveValue("copy");
    fireEvent.click(screen.getByRole("tab", { name: /Subtitles/ }));
    expect(screen.getByRole("combobox", { name: "Action for stream 2" })).toHaveValue("copy");
    fireEvent.click(screen.getByRole("tab", { name: /Video/ }));
    const streamAction = screen.getByRole("combobox", { name: "Action for stream 0" });
    expect(streamAction).toHaveValue("copy");
    expect(streamAction).toHaveClass("settings-choice-input", "transcode-control", "transcode-action-select");
    expect(streamAction).toHaveAttribute("title", "Copy keeps the source stream unchanged. Encode converts it with the selected controls. Remove excludes it from the output.");
    expect(streamAction.closest(".transcode-action-field")).toHaveClass("is-collapsed");
    expect(screen.queryByRole("combobox", { name: "video 0 dynamic range" })).not.toBeInTheDocument();
    fireEvent.change(streamAction, { target: { value: "encode" } });
    fireEvent.click(screen.getByRole("button", { name: /video 0: H\.265 \/ HEVC/ }));
    expect(screen.getByRole("button", { name: /video 0: H\.265 \/ HEVC/ })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("combobox", { name: "Action for stream 0" }).closest(".transcode-action-field")).toHaveClass("is-expanded");
    expect(screen.queryByRole("button", { name: "Explain stream action" })).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Output mode" })).toHaveAttribute("title", "Separate output works with a read-only media mount; same-directory and replacement require a writable media directory.");
    expect(screen.getByRole("combobox", { name: "Execution target" })).toHaveAttribute("title", "Execution target: local. Automatic mode includes queueing, transfer, transcoding and result publishing.");
    expect(screen.getByRole("combobox", { name: "video 0 dynamic range" })).toHaveValue("preserve");
    expect(screen.getByRole("slider", { name: "video 0 quality" })).toHaveClass("settings-choice-input", "transcode-control", "transcode-quality-range", "is-reversed");
    const qualityValue = screen.getByRole("spinbutton", { name: "video 0 quality value" });
    expect(qualityValue).toHaveValue(23);
    fireEvent.change(qualityValue, { target: { value: "29" } });
    expect(qualityValue).toHaveValue(29);
    expect(screen.getByRole("combobox", { name: "video 0 speed preset" })).toHaveValue("medium");
    expect(screen.getByRole("combobox", { name: "video 0 resolution" })).toHaveClass("settings-choice-input", "transcode-control");
    expect(screen.getByRole("combobox", { name: "video 0 codec" })).toHaveValue("h264");
    expect(screen.queryByRole("combobox", { name: "video 0 encoder" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Locally reported encoder options/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "video 0 codec" }), { target: { value: "av1" } });
    expect(screen.getByRole("combobox", { name: "video 0 speed preset" })).toHaveValue("medium");
    fireEvent.change(screen.getByRole("combobox", { name: "video 0 speed preset" }), { target: { value: "slow" } });
    fireEvent.change(screen.getByRole("combobox", { name: "video 0 resolution" }), { target: { value: "1280x720" } });
    fireEvent.change(screen.getByRole("combobox", { name: "video 0 dynamic range" }), { target: { value: "hdr10" } });
    fireEvent.click(screen.getByRole("tab", { name: /Subtitles/ }));
    fireEvent.change(screen.getByRole("combobox", { name: "Action for stream 2" }), { target: { value: "drop" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /Movie\.en\.srt/ }));
    fireEvent.click(screen.getByRole("button", { name: "Validate plan" }));

    expect((await screen.findAllByText(validation.output_filename)).length).toBeGreaterThan(0);
    expect(screen.getByText("video stream 0, audio stream 1")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Generated FFmpeg command"));
    expect(screen.getAllByText(validation.ffmpeg_command).length).toBeGreaterThan(0);
    expect(screen.getByText(/Poster Font\.ttf/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Open synchronized preview" })).not.toBeInTheDocument();

    const sentPlan = vi.mocked(api.validateFileTranscode).mock.calls[0][1];
    expect(sentPlan.video_streams[0].width).toBe(1280);
    expect(sentPlan.video_streams[0].codec).toBe("av1");
    expect(sentPlan.video_streams[0].encoder).toBeNull();
    expect(sentPlan.audio_streams[0].encoder).toBeNull();
    expect(sentPlan.video_streams[0].preset).toBe("slow");
    expect(sentPlan.dynamic_range).toBe("hdr10");
    expect(sentPlan.subtitle_streams[0].action).toBe("drop");
    expect(sentPlan.external_subtitles[0]).toMatchObject({ subtitle_id: 8, action: "encode" });
  });

  it("starts a validated job, shows progress, and cancels it", async () => {
    render(<MemoryRouter><TranscodingPanel file={file} /></MemoryRouter>);
    await screen.findAllByText("Movie.mkv");
    fireEvent.click(screen.getByRole("button", { name: "Start transcoding" }));

    expect(await screen.findByText("25%")).toBeInTheDocument();
    expect(screen.getByText(/2.0×/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(api.cancelTranscodeJob).toHaveBeenCalledWith(5));
  });

  it("previews the generated filename and supports metadata tokens with a custom divider", async () => {
    render(<MemoryRouter><TranscodingPanel file={file} /></MemoryRouter>);
    await screen.findAllByText("Movie.mkv");

    expect(screen.getByText("Movie [3840x2160, HDR10, HEVC] [en].mp4")).toBeInTheDocument();
    expect(screen.queryByText("Type text directly or insert metadata tokens with Add metadata.")).not.toBeInTheDocument();
    expect(screen.getByText("Finished filename preview").closest(".transcode-filename-preview")).toHaveClass("is-prominent");
    expect(screen.getByRole("textbox", { name: "Metadata divider" }).closest(".transcode-filename-options-row")).toContainElement(screen.getByRole("combobox", { name: "Removal preset" }));
    const templateInput = screen.getByRole("textbox", { name: "Filename template" });
    expect(templateInput).not.toBeDisabled();
    expect(templateInput.textContent).toBe("[{resolution}, {dynRange}, {codec}] [{audioLanguages}]");
    expect(templateInput.querySelector('[data-filename-token="resolution"]')).toBeInTheDocument();

    const audioToken = templateInput.querySelector('[data-filename-token="audioLanguages"]');
    expect(audioToken).toBeInTheDocument();
    templateInput.focus();
    const insertionCaret = document.createRange();
    insertionCaret.setStartAfter(audioToken as Node);
    insertionCaret.collapse(true);
    const insertionSelection = window.getSelection();
    insertionSelection?.removeAllRanges();
    insertionSelection?.addRange(insertionCaret);
    fireEvent.select(templateInput);

    const addMetadata = screen.getByRole("button", { name: "Add metadata" });
    fireEvent.click(addMetadata);
    expect(addMetadata).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(screen.getByRole("button", { name: "Subtitle languages" }));
    expect(templateInput.textContent).toBe("[{resolution}, {dynRange}, {codec}] [{audioLanguages}{subtitleLanguages}]");

    templateInput.textContent = "[{resolution}, {dynRange}, {codec}] [{audioLanguages}] [{subtitleLanguages}]";
    fireEvent.input(templateInput);
    expect(screen.getByText("Movie [3840x2160, HDR10, HEVC] [en] [de].mp4")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox", { name: /Movie\.en\.srt/ }));
    expect(screen.getByText("Movie [3840x2160, HDR10, HEVC] [en] [de, en].mp4")).toBeInTheDocument();

    const dividerInput = screen.getByRole("textbox", { name: "Metadata divider" });
    fireEvent.change(dividerInput, { target: { value: "," } });
    expect(screen.getByText("Movie [3840x2160, HDR10, HEVC] [en] [de,en].mp4")).toBeInTheDocument();

    templateInput.textContent = "[{codec}] [{subtitleLanguages}]";
    fireEvent.input(templateInput);
    expect(screen.getByText("Movie [HEVC] [de,en].mp4")).toBeInTheDocument();

    const subtitleToken = templateInput.querySelector('[data-filename-token="subtitleLanguages"]');
    expect(subtitleToken).toBeInTheDocument();
    templateInput.focus();
    const selection = document.createRange();
    selection.setStartAfter(subtitleToken as Node);
    selection.collapse(true);
    const browserSelection = window.getSelection();
    browserSelection?.removeAllRanges();
    browserSelection?.addRange(selection);
    fireEvent.keyDown(templateInput, { key: "Backspace" });
    await waitFor(() => expect(templateInput.textContent).toBe("[{codec}] []"));
  });

  it("keeps the transcode history in the combined file history section", async () => {
    render(<MemoryRouter><FileTranscodeHistory fileId={file.id} /></MemoryRouter>);

    expect(await screen.findByRole("heading", { name: "File & Transcode history" })).toBeInTheDocument();
    expect(screen.getByText("Movie [1080p].mp4")).toBeInTheDocument();
  });

  it("keeps the embedded progress view compact and hides empty attachments and raw probe details", async () => {
    vi.mocked(api.fileTranscode).mockResolvedValue({ ...payload, attachments: [] });
    render(<MemoryRouter><TranscodingPanel file={file} /></MemoryRouter>);
    await screen.findAllByText("Movie.mkv");

    expect(screen.queryByText("Raw ffprobe JSON")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Attachments" })).not.toBeInTheDocument();
    expect(screen.queryByText("No embedded attachments detected.")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Start transcoding" }));

    const progress = await screen.findByRole("link", { name: "Open transcoding center" });
    expect(progress).toHaveAttribute("href", "/transcoding");
    expect(progress.closest(".transcode-progress-compact")).toBeInTheDocument();
    expect(screen.getByTestId("echarts-react")).toBeInTheDocument();
  });

  it("collapses filename controls and removes selected source-name sections", async () => {
    const filename = { ...file, filename: "Movie [1080p] (WEB-DL).mkv" } as MediaFileDetail;
    render(<MemoryRouter><TranscodingPanel file={filename} /></MemoryRouter>);
    await screen.findAllByText("Movie.mkv");

    const toggle = screen.getByRole("button", { name: "Filename template" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("textbox", { name: "Filename template" })).not.toBeInTheDocument();

    fireEvent.click(toggle);
    const cleanupPreset = screen.getByRole("combobox", { name: "Removal preset" });
    fireEvent.change(cleanupPreset, { target: { value: "square_and_round_brackets" } });
    expect(screen.getByText("Movie [3840x2160, HDR10, HEVC] [en].mp4")).toBeInTheDocument();

    fireEvent.change(cleanupPreset, { target: { value: "custom" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Custom regular expression" }), { target: { value: "\\s*\\[[^\\]]*\\]" } });
    expect(screen.getByText("Movie (WEB-DL) [3840x2160, HDR10, HEVC] [en].mp4")).toBeInTheDocument();
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
