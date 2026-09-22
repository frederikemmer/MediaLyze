import "../i18n";

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";

import {
  api,
  type FileConnectorSource,
  type FileTranscode,
  type MediaFileDetail,
  type ResolutionCategory,
  type TranscodeCapabilities,
  type TranscodeJob,
  type TranscodePlan,
  type TranscodePresetPlan,
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
  video_streams: [{ stream_index: 0, codec: "hevc", width: 3840, height: 2160, frame_rate: 23.976, bit_depth: 10 }],
  audio_streams: [{ stream_index: 1, codec: "aac", profile: "LC", spatial_audio_profile: "dolby_atmos", language: "en", channels: 6, channel_layout: "5.1", default_flag: true }],
  subtitle_streams: [{ stream_index: 2, codec: "subrip", language: "de", default_flag: true, forced_flag: false, subtitle_type: "text" }],
  external_subtitles: [{ id: 8, path: "Movie.en.srt", language: "en", format: "srt" }],
  content_category: "bonus",
  series_title: "Example Show",
  season_number: 2,
  episode_number: 3,
  episode_title: "Pilot",
  raw_ffprobe_json: { format: { format_name: "matroska" } },
} as unknown as MediaFileDetail;

const multiStreamFile = {
  ...file,
  audio_streams: [
    { stream_index: 1, codec: "aac", language: "en", channels: 2, default_flag: true, forced_flag: false },
    { stream_index: 3, codec: "aac", language: "de", channels: 2, default_flag: false, forced_flag: false },
    { stream_index: 5, codec: "aac", language: "fr", channels: 2, default_flag: false, forced_flag: false },
  ],
} as unknown as MediaFileDetail;

function renderTranscodingPanel(
  targetFile: MediaFileDetail = file,
  connectorSources: FileConnectorSource[] = [],
  resolutionCategories?: ResolutionCategory[],
) {
  const presetHeaderTarget = document.createElement("div");
  presetHeaderTarget.dataset.transcodePresetTarget = "";
  document.body.append(presetHeaderTarget);
  return render(
    <MemoryRouter>
      <TranscodingPanel
        file={targetFile}
        presetHeaderTarget={presetHeaderTarget}
        connectorSources={connectorSources}
        resolutionCategories={resolutionCategories}
      />
    </MemoryRouter>,
  );
}

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

const builtInPresets = {
  compatibility: compatibilityPlan,
  storage: { ...compatibilityPlan, profile: "storage" as const, container: "mkv" as const },
  modern: { ...compatibilityPlan, profile: "modern" as const, container: "mkv" as const },
};

const multiStreamPlan: TranscodePlan = {
  ...compatibilityPlan,
  audio_streams: [
    { stream_index: 1, action: "copy", default_flag: true },
    { stream_index: 3, action: "copy", default_flag: false },
    { stream_index: 5, action: "copy", default_flag: false },
  ],
};

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
  presets: builtInPresets,
  profiles: builtInPresets,
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

const multiStreamPayload: FileTranscode = {
  ...payload,
  presets: { ...builtInPresets, compatibility: multiStreamPlan },
  profiles: { ...builtInPresets, compatibility: multiStreamPlan },
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

const savedPreset: TranscodePresetPlan = {
  preset: {
    id: 9,
    name: "Archive preset",
    description: "A saved preset for archive files.",
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
    document.querySelectorAll<HTMLElement>("[data-transcode-preset-target]").forEach((target) => target.remove());
    vi.restoreAllMocks();
  });

  it("edits structured stream fields without rendering a separate variant section", async () => {
    renderTranscodingPanel();

    expect(await screen.findByRole("region", { name: "Source summary" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Linked variants" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Transcoding history" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("tab")).toHaveLength(3);
    const videoTab = screen.getByRole("tab", { name: /Video/ });
    expect(videoTab).toHaveAttribute("aria-selected", "true");
    expect(videoTab.querySelector(".transcode-stream-tab-count")?.textContent).toBe("1");
    expect(screen.getByRole("tab", { name: /Audio/ }).querySelector(".transcode-stream-tab-count")?.textContent).toBe("1");
    expect(screen.getByRole("tab", { name: /Subtitles/ }).querySelector(".transcode-stream-tab-count")?.textContent).toBe("1");
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
    expect(screen.getByRole("button", { name: /video 0: H\.265 \/ HEVC/ })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("combobox", { name: "Action for stream 0" }).closest(".transcode-action-field")).toHaveClass("is-expanded");
    expect(screen.getByRole("combobox", { name: "video 0 codec" })).toHaveValue("hevc");
    expect(screen.getByRole("combobox", { name: "video 0 resolution" })).toHaveValue("3840x2160");
    fireEvent.change(streamAction, { target: { value: "copy" } });
    expect(screen.getByRole("button", { name: /video 0: H\.265 \/ HEVC/ })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("combobox", { name: "Action for stream 0" }).closest(".transcode-action-field")).toHaveClass("is-collapsed");
    fireEvent.change(streamAction, { target: { value: "encode" } });
    expect(screen.getByRole("button", { name: /video 0: H\.265 \/ HEVC/ })).toHaveAttribute("aria-expanded", "true");
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
    expect(screen.getByRole("combobox", { name: "video 0 codec" })).toHaveValue("hevc");
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

  it("keeps one default stream first and moves removed streams to the end", async () => {
    vi.mocked(api.fileTranscode).mockResolvedValue(multiStreamPayload);
    renderTranscodingPanel(multiStreamFile);
    await screen.findByRole("region", { name: "Source summary" });

    fireEvent.click(screen.getByRole("tab", { name: /Audio/ }));
    const streamOrder = () => Array.from(document.querySelectorAll(".transcode-stream-list-item strong"), (node) => node.textContent);
    expect(streamOrder()).toEqual(["#1", "#3", "#5"]);
    expect(screen.getByRole("button", { name: "Default stream" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Default stream" })).not.toBeDisabled();

    const stream3 = screen.getByRole("combobox", { name: "Action for stream 3" }).closest(".transcode-stream-list-item");
    expect(stream3).not.toBeNull();
    fireEvent.click(within(stream3 as HTMLElement).getByRole("button", { name: "Set as default stream" }));
    expect(streamOrder()).toEqual(["#3", "#1", "#5"]);
    expect(within(stream3 as HTMLElement).getByRole("button", { name: "Default stream" })).toHaveAttribute("aria-pressed", "true");

    const stream1Action = screen.getByRole("combobox", { name: "Action for stream 1" });
    fireEvent.change(stream1Action, { target: { value: "drop" } });
    expect(streamOrder()).toEqual(["#3", "#5", "#1"]);
    expect(stream1Action.closest(".transcode-stream-list-item")).toHaveClass("is-dropped");
    expect(stream1Action.closest(".transcode-action-field")).toHaveClass("is-collapsed");

    const stream5Action = screen.getByRole("combobox", { name: "Action for stream 5" });
    fireEvent.change(stream5Action, { target: { value: "encode" } });
    expect(stream5Action.closest(".transcode-stream-list-item")?.querySelector(".transcode-stream-row-trigger")).toHaveAttribute("aria-expanded", "true");
    expect(stream5Action.closest(".transcode-action-field")).toHaveClass("is-expanded");
    fireEvent.change(stream5Action, { target: { value: "copy" } });
    expect(stream5Action.closest(".transcode-stream-list-item")?.querySelector(".transcode-stream-row-trigger")).toHaveAttribute("aria-expanded", "false");
    expect(stream5Action.closest(".transcode-action-field")).toHaveClass("is-collapsed");
  });

  it("filters streams by source metadata while keeping the category count", async () => {
    vi.mocked(api.fileTranscode).mockResolvedValue(multiStreamPayload);
    renderTranscodingPanel(multiStreamFile);
    await screen.findByRole("region", { name: "Source summary" });

    fireEvent.click(screen.getByRole("tab", { name: /Audio/ }));
    expect(screen.getByRole("tab", { name: /Audio/ }).querySelector(".transcode-stream-tab-count")?.textContent).toBe("3");
    expect(screen.getByRole("tabpanel").parentElement).toHaveClass("compatibility-profile-list", "transcode-stream-catalog");
    const search = screen.getByRole("searchbox", { name: "Search Audio streams" });
    fireEvent.change(search, { target: { value: "de aac" } });

    expect(screen.getByRole("combobox", { name: "Action for stream 3" })).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Action for stream 1" })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Action for stream 5" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear stream search" }));
    expect(screen.getByRole("combobox", { name: "Action for stream 1" })).toBeInTheDocument();
  });

  it("seeds encode controls from the source stream when leaving copy or remove", async () => {
    renderTranscodingPanel();
    await screen.findByRole("region", { name: "Source summary" });

    fireEvent.click(screen.getByRole("tab", { name: /Audio/ }));
    const audioAction = screen.getByRole("combobox", { name: "Action for stream 1" });
    fireEvent.change(audioAction, { target: { value: "encode" } });
    expect(screen.getByRole("combobox", { name: "audio 1 codec" })).toHaveValue("aac");
    expect(screen.getByRole("combobox", { name: "audio 1 language" })).toHaveValue("en");

    fireEvent.change(audioAction, { target: { value: "drop" } });
    fireEvent.change(audioAction, { target: { value: "encode" } });
    expect(screen.getByRole("combobox", { name: "audio 1 codec" })).toHaveValue("aac");
    expect(screen.getByRole("combobox", { name: "audio 1 language" })).toHaveValue("en");

    fireEvent.click(screen.getByRole("tab", { name: /Subtitles/ }));
    const subtitleAction = screen.getByRole("combobox", { name: "Action for stream 2" });
    fireEvent.change(subtitleAction, { target: { value: "encode" } });
    expect(screen.getByRole("combobox", { name: "subtitle 2 codec" })).toHaveValue("mov_text");
    expect(screen.getByRole("combobox", { name: "subtitle 2 language" })).toHaveValue("de");
  });

  it("starts a validated job, shows progress, and cancels it", async () => {
    renderTranscodingPanel();
    await screen.findByRole("region", { name: "Source summary" });
    fireEvent.click(screen.getByRole("button", { name: "Start transcoding" }));

    expect(await screen.findByText("25%")).toBeInTheDocument();
    expect(screen.getByText(/2.0×/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(api.cancelTranscodeJob).toHaveBeenCalledWith(5));
  });

  it("previews the generated filename and supports metadata tokens with a custom divider", async () => {
    renderTranscodingPanel();
    await screen.findByRole("region", { name: "Source summary" });

    expect(screen.getByText("Movie [3840x2160, HDR10, HEVC] [en].mp4")).toBeInTheDocument();
    expect(screen.queryByText("Type text directly or insert metadata tokens with Add metadata.")).not.toBeInTheDocument();
    expect(screen.getByText("Finished filename preview").closest(".transcode-filename-preview")).toHaveClass("is-prominent");
    expect(screen.getByRole("textbox", { name: "Metadata divider" }).closest(".transcode-filename-options-row")).toContainElement(screen.getByRole("combobox", { name: "Removal preset" }));
    expect(screen.getByText("Source filename cleanup").closest(".transcode-field-label")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Explain source filename cleanup" })).toBeInTheDocument();
    const templateInput = screen.getByRole("textbox", { name: "Filename formatting" });
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

  it("previews technical, episode, and content-category metadata tokens", async () => {
    const tokenPlan: TranscodePlan = {
      ...compatibilityPlan,
      video_streams: [{ stream_index: 0, action: "copy" }],
      audio_streams: [{ stream_index: 1, action: "copy" }],
      subtitle_streams: [{ stream_index: 2, action: "copy" }],
    };
    vi.mocked(api.fileTranscode).mockResolvedValue({
      ...payload,
      presets: { compatibility: tokenPlan, storage: builtInPresets.storage, modern: builtInPresets.modern },
      profiles: { ...payload.profiles, compatibility: tokenPlan },
    });
    renderTranscodingPanel(file, [], [
      { id: "uhd", label: "UHD", min_width: 3648, min_height: 1600 },
      { id: "fullhd", label: "Full HD", min_width: 1824, min_height: 760 },
      { id: "sd", label: "SD", min_width: 0, min_height: 0 },
    ]);
    await screen.findByRole("region", { name: "Source summary" });

    fireEvent.click(screen.getByRole("button", { name: "Add metadata" }));
    fireEvent.focus(screen.getByRole("button", { name: "Resolution" }));
    const metadataTooltip = await screen.findByRole("tooltip");
    expect(metadataTooltip).toHaveTextContent("{resolution}");
    expect(metadataTooltip).toHaveTextContent("Resolution");
    expect(metadataTooltip).not.toHaveTextContent("{token}");
    expect(metadataTooltip).not.toHaveTextContent("{label}");
    expect(metadataTooltip).toHaveTextContent("3840x2160");
    expect(metadataTooltip).toHaveTextContent("Example in filename");
    expect(screen.getByRole("button", { name: "Resolution category" })).toBeInTheDocument();
    for (const label of ["Audio codecs", "Audio profiles", "Audio channels", "Frame rate", "Bit depth", "Subtitle formats", "Series name", "Season number", "Episode number", "Episode title", "Content category"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }

    const templateInput = screen.getByRole("textbox", { name: "Filename formatting" });
    templateInput.textContent = "[{resolutionCategory}]";
    fireEvent.input(templateInput);
    expect(screen.getByText("Movie [UHD].mp4")).toBeInTheDocument();
    templateInput.textContent = "[{audioCodecs}, {audioProfiles}, {audioChannels}, {frameRate}, {bitDepth}, {subtitleFormats}, {seriesName}, S{seasonNumber}E{episodeNumber}, {episodeTitle}, {contentCategory}]";
    fireEvent.input(templateInput);
    expect(screen.getByText("Movie [AAC, Dolby Atmos, 5.1, 23.976 fps, 10-bit, SRT, Example Show, S2E3, Pilot, bonus].mp4")).toBeInTheDocument();
  });

  it("offers a connector release-year token when the asset has connector metadata", async () => {
    renderTranscodingPanel(file, [{
      connection_id: 3,
      connection_name: "Jellyfin",
      provider: "jellyfin",
      connector_item_id: 12,
      remote_id: "movie-12",
      title: "Movie",
      item_type: "Movie",
      remote_path: "/media/Movie.mkv",
      match_method: "path",
      preferred: true,
      original_title: null,
      series_name: "Connector Show",
      season_name: "Season 4",
      season_number: 4,
      episode_number: 5,
      episode_title: "Connector Pilot",
      date_created: null,
      premiere_date: "2014-12-19T00:00:00Z",
      production_year: 2014,
      overview: null,
      provider_ids: {},
      provider_payload: {},
    }]);
    await screen.findByRole("region", { name: "Source summary" });

    fireEvent.click(screen.getByRole("button", { name: "Add metadata" }));
    expect(screen.getByRole("button", { name: "Release year" })).toBeInTheDocument();
    const templateInput = screen.getByRole("textbox", { name: "Filename formatting" });
    templateInput.focus();
    const selection = document.createRange();
    selection.selectNodeContents(templateInput);
    selection.collapse(false);
    const browserSelection = window.getSelection();
    browserSelection?.removeAllRanges();
    browserSelection?.addRange(selection);
    fireEvent.select(templateInput);
    fireEvent.click(screen.getByRole("button", { name: "Release year" }));

    expect(templateInput.textContent).toContain("{releaseYear}");
    expect(screen.getByText("Movie [3840x2160, HDR10, HEVC] [en]2014.mp4")).toBeInTheDocument();

    templateInput.textContent = "[{seriesName}, S{seasonNumber}E{episodeNumber}, {episodeTitle}]";
    fireEvent.input(templateInput);
    expect(screen.getByText("Movie [Connector Show, S4E5, Connector Pilot].mp4")).toBeInTheDocument();
  });

  it("uses series-aware independent filename and direct-folder formatting switches", async () => {
    const seriesPlan: TranscodePlan = {
      ...compatibilityPlan,
      filename_format_enabled: false,
      folder_format_enabled: true,
      folder_template: "{folderName}",
      folder_template_override: false,
    };
    vi.mocked(api.fileTranscode).mockResolvedValue({
      ...payload,
      original: { ...payload.original, library_type: "series", relative_path: "Shows/Season 2/Movie.mkv" },
      presets: { ...(payload.presets ?? builtInPresets), compatibility: seriesPlan },
      profiles: { ...payload.profiles, compatibility: seriesPlan },
    });
    renderTranscodingPanel();
    await screen.findByRole("region", { name: "Source summary" });

    const filenameSwitch = screen.getByRole("switch", { name: "Enable filename formatting" });
    const folderSwitch = screen.getByRole("switch", { name: "Enable folder name formatting" });
    expect(filenameSwitch).not.toBeChecked();
    expect(folderSwitch).toBeChecked();
    const filenameHeader = screen.getByRole("button", { name: "Filename formatting" }).closest("header");
    const folderHeader = screen.getByRole("button", { name: "Folder name formatting" }).closest("header");
    expect(filenameHeader?.children[0]).toHaveClass("transcode-filename-chevron-toggle");
    expect(filenameHeader?.children[1]).toHaveClass("transcode-formatting-toggle");
    expect(filenameHeader?.children[2]).toHaveClass("transcode-filename-toggle");
    expect(filenameHeader?.children[3]).toHaveClass("transcode-filename-header-tooltip");
    expect(filenameHeader?.children[4]).toHaveClass("transcode-formatting-preset-select");
    expect(folderHeader?.children[0]).toHaveClass("transcode-filename-chevron-toggle");
    expect(folderHeader?.children[1]).toHaveClass("transcode-formatting-toggle");
    expect(folderHeader?.children[2]).toHaveClass("transcode-filename-toggle");
    expect(folderHeader?.children[3]).toHaveClass("transcode-filename-header-tooltip");
    expect(folderHeader?.children[4]).toHaveClass("transcode-formatting-preset-select");
    expect(screen.getByRole("combobox", { name: "Filename formatting preset" })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Folder name formatting preset" })).toBeDisabled();
    expect(screen.queryByRole("textbox", { name: "Filename formatting" })).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Folder name template" })).toBeInTheDocument();

    fireEvent.click(filenameSwitch);
    expect(screen.getByRole("textbox", { name: "Filename formatting" })).toBeInTheDocument();
    fireEvent.click(folderSwitch);
    expect(screen.queryByRole("textbox", { name: "Folder name template" })).not.toBeInTheDocument();
  });

  it("keeps the transcode history in the combined file history section", async () => {
    render(<MemoryRouter><FileTranscodeHistory fileId={file.id} /></MemoryRouter>);

    expect(await screen.findByRole("heading", { name: "File & Transcode history" })).toBeInTheDocument();
    expect(screen.getByText("Movie [1080p].mp4")).toBeInTheDocument();
  });

  it("keeps the embedded progress view compact and hides empty attachments and raw probe details", async () => {
    vi.mocked(api.fileTranscode).mockResolvedValue({ ...payload, attachments: [] });
    renderTranscodingPanel();
    await screen.findByRole("region", { name: "Source summary" });

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
    renderTranscodingPanel(filename);
    await screen.findByRole("region", { name: "Source summary" });

    const toggle = screen.getByRole("button", { name: "Filename formatting" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("textbox", { name: "Filename formatting" })).not.toBeInTheDocument();

    fireEvent.click(toggle);
    const cleanupPreset = screen.getByRole("combobox", { name: "Removal preset" });
    fireEvent.change(cleanupPreset, { target: { value: "square_and_round_brackets" } });
    expect(screen.getByText("Movie [3840x2160, HDR10, HEVC] [en].mp4")).toBeInTheDocument();

    fireEvent.change(cleanupPreset, { target: { value: "custom" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Custom regular expression" }), { target: { value: "\\s*\\[[^\\]]*\\]" } });
    expect(screen.getByText("Movie (WEB-DL) [3840x2160, HDR10, HEVC] [en].mp4")).toBeInTheDocument();
  });

  it("applies a saved preset and switches back to expert editing", async () => {
    vi.mocked(api.fileTranscode).mockResolvedValue({ ...payload, saved_presets: [savedPreset] });
    renderTranscodingPanel();
    await screen.findByRole("region", { name: "Source summary" });

    const presetSelect = screen.getByRole("combobox", { name: "Select preset" });
    expect(presetSelect).toHaveValue("");
    fireEvent.change(presetSelect, { target: { value: "saved:9" } });
    expect(presetSelect).toHaveValue("saved:9");
    expect(screen.getByRole("combobox", { name: "Target container" })).toHaveValue("mkv");

    fireEvent.change(screen.getByRole("combobox", { name: "Target container" }), { target: { value: "mp4" } });
    expect(presetSelect).toHaveValue("expert");
  });

  it("shows a compact source summary and groups metadata options below the filename template", async () => {
    renderTranscodingPanel();
    await screen.findByRole("region", { name: "Source summary" });

    const summary = screen.getByRole("region", { name: "Source summary" });
    expect(summary.querySelectorAll("dl > div")).toHaveLength(5);
    expect(summary).toHaveTextContent("9.8 KB");
    expect(summary).toHaveTextContent("2m");
    expect(summary).toHaveTextContent("3840x2160");
    expect(summary).toHaveTextContent("HEVC");
    expect(summary).toHaveTextContent("HDR10");
    expect(summary).not.toHaveTextContent("Movie.mkv");
    const presetSelect = await screen.findByRole("combobox", { name: "Select preset" });
    expect(presetSelect).toHaveValue("");

    const filenameToggle = screen.getByRole("button", { name: "Filename formatting" });
    const metadataToggle = screen.getByRole("button", { name: "Metadata settings" });
    const filenameCard = filenameToggle.closest("section");
    const metadataCard = metadataToggle.closest("section");
    expect(filenameCard).not.toBeNull();
    expect(metadataCard).not.toBeNull();
    expect(filenameCard!.compareDocumentPosition(metadataCard!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    expect(metadataToggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("checkbox", { name: "Keep chapters" })).not.toBeInTheDocument();
    fireEvent.click(metadataToggle);
    expect(metadataToggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("checkbox", { name: "Keep chapters" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Keep metadata" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Keep cover" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Keep attachments" })).toBeChecked();
    expect(metadataCard!.querySelector(".transcode-metadata-option-list")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Explain keeping chapters" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Explain keeping metadata" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Explain keeping the cover" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Explain keeping attachments" })).toBeInTheDocument();
    const languageCodeFormat = screen.getByRole("combobox", { name: "Filename language code format" });
    expect(languageCodeFormat).toHaveValue("iso_639_1");
    fireEvent.change(languageCodeFormat, { target: { value: "iso_639_2" } });
    expect(languageCodeFormat).toHaveValue("iso_639_2");
    expect(screen.getByText(/\[eng\]/)).toBeInTheDocument();
  });
});
