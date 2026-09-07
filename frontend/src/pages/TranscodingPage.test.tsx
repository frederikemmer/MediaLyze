import "../i18n";

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";

import { api, type AppSettings, type FileTranscode, type TranscodeCapabilities, type TranscodeJob, type TranscodePlan } from "../lib/api";
import { TRANSCODING_COLUMN_WIDTHS_STORAGE_KEY } from "../lib/transcoding-column-widths";
import { TranscodingPage } from "./TranscodingPage";

const appDataMock = vi.hoisted(() => ({
  value: {
    appSettings: {
      transcoding: {
        execution_mode: "hardware_required",
        cpu_budget_percent: 90,
        cpu_parallel_jobs: 1,
        gpu_parallel_jobs_per_device: 2,
        selected_devices: "auto",
        default_output_mode: "transcode_output",
        on_error: "continue",
        retry_count: 0,
        existing_output: "fail",
        remove_partial_output: true,
      },
    } as AppSettings,
    libraries: [
      { id: 1, name: "Movies" },
      { id: 2, name: "Series" },
    ],
  },
}));

vi.mock("../lib/app-data", () => ({
  useAppData: () => appDataMock.value,
}));

const plan: TranscodePlan = {
  version: 1,
  profile: "storage",
  container: "mkv",
  video_streams: [
    { stream_index: 0, action: "encode", codec: "hevc", encoder: "hevc_nvenc", width: 3840, height: 2160, crf: 20 },
  ],
  audio_streams: [],
  subtitle_streams: [],
  external_subtitles: [],
  dynamic_range: "hdr10",
  chapters: "keep",
  metadata: "keep",
  cover: "keep",
  attachments: "keep",
  filename_template: "[{resolution}, {codec}]",
  output_mode: "transcode_output",
  execution_mode: "hardware_required",
};

function createJob(id: number, overrides: Partial<TranscodeJob> = {}): TranscodeJob {
  return {
    id,
    group_id: id,
    library_id: 1,
    source_file_id: id,
    source_video_codec: "h264",
    source_dynamic_range: "sdr",
    result_file_id: null,
    status: "running",
    profile: "storage",
    plan_version: 1,
    plan,
    ffmpeg_arguments: [],
    ffmpeg_command: "ffmpeg -i source.mkv -c:v hevc_nvenc output.mkv",
    warnings: [],
    source_path_snapshot: `/media/movies/Naturefilm-${id}.mkv`,
    output_path_snapshot: `/media/Transcode_Output/Naturefilm-${id}.mkv`,
    output_relative_path: `Naturefilm-${id}.mkv`,
    output_mode: "transcode_output",
    output_storage_root: "/media/Transcode_Output",
    retry_count: 0,
    attempt: 1,
    cpu_budget_percent: 90,
    cpu_thread_budget: 4,
    device_id: "cuda:0",
    hardware_backend: "cuda",
    ffmpeg_version: "7.0",
    remove_partial_output: true,
    on_error: "continue",
    progress_percent: 64,
    processed_seconds: 1721,
    speed: "3.2x",
    eta_seconds: 720,
    error: null,
    created_at: "2026-09-07T12:00:00Z",
    updated_at: "2026-09-07T12:28:41Z",
    started_at: "2026-09-07T12:00:00Z",
    finished_at: null,
    ...overrides,
  };
}

const capabilities: TranscodeCapabilities = {
  ffmpeg_available: true,
  ffmpeg_path: "ffmpeg",
  version: "7.0",
  containers: ["mkv", "mp4", "webm"],
  encoders: [],
  devices: [
    {
      id: "cuda:0",
      name: "NVIDIA RTX 3080",
      vendor: "nvidia",
      backend: "cuda",
      driver_version: null,
      compute_capability: null,
      memory_total_bytes: null,
      decoder_codecs: ["hevc"],
      encoder_codecs: ["hevc"],
      supported_pixel_formats: [],
      supported_filters: [],
      status: "available",
      failure_reason: null,
      last_tested_at: "2026-09-07T11:00:00Z",
    },
  ],
  dolby_vision_passthrough: false,
  error: null,
};

function createFileTranscode(): FileTranscode {
  return {
    original: {
      id: 10,
      filename: "Bulk-one.mkv",
      relative_path: "Bulk-one.mkv",
      size_bytes: 1_000_000,
      duration_seconds: 120,
      width: 1920,
      height: 1080,
      dynamic_range: "sdr",
      video_codec: "h264",
      audio_codecs: [],
      audio_languages: [],
    },
    profiles: { compatibility: plan, storage: plan, modern: plan },
    attachments: [],
    variants: [],
    jobs: [],
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/transcoding"]}>
      <Routes>
        <Route path="/transcoding" element={<TranscodingPage />} />
        <Route path="/files/:fileId" element={<div>File detail destination</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  vi.spyOn(api, "activeTranscodeJobs").mockResolvedValue({ items: [createJob(1), createJob(2, { status: "queued", speed: null, device_id: null, hardware_backend: null, progress_percent: 0 })], total: 2 });
  vi.spyOn(api, "transcodeJobs").mockResolvedValue({ items: [createJob(3, { status: "completed", progress_percent: 100, speed: null, eta_seconds: null, finished_at: "2026-09-07T12:40:00Z" })], total: 1 });
  vi.spyOn(api, "transcodeCapabilities").mockResolvedValue(capabilities);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("TranscodingPage", () => {
  it("shows live progress, speed, hardware, and the expandable job details", async () => {
    renderPage();

    expect(await screen.findByRole("heading", { name: "Transcoding" })).toBeInTheDocument();
    expect(screen.queryByText("Start several jobs together and keep an eye on their live throughput, hardware path, and queue state.")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Transcoding job summary")).not.toBeInTheDocument();
    expect(screen.getByText("1 running")).toBeInTheDocument();
    expect(screen.getByText("1 queued")).toBeInTheDocument();
    expect(screen.getByText("1 completed")).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader")).toHaveLength(5);
    expect(screen.getByText("Naturefilm-1.mkv")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Naturefilm-1.mkv" })).not.toBeInTheDocument();
    expect(screen.getAllByText("NVIDIA RTX 3080").length).toBeGreaterThan(0);
    const hardwareLoad = screen.getByRole("region", { name: "Hardware load" });
    expect(hardwareLoad.closest("header")).not.toBeNull();
    const hardwareTrigger = screen.getByRole("button", { name: "Show hardware load details for NVIDIA RTX 3080" });
    fireEvent.click(hardwareTrigger);
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Encoder codecs");
    expect(screen.getByRole("tooltip")).toHaveTextContent("Decoder codecs");
    expect(screen.getByText("3.2×")).toBeInTheDocument();
    expect(screen.getByText("64%")).toBeInTheDocument();
    const progressCell = screen.getByText("64%").closest("td");
    expect(progressCell).not.toBeNull();
    expect(within(progressCell!).getByText("Progress")).toBeInTheDocument();
    expect(within(progressCell!).getByText("Time left")).toBeInTheDocument();
    expect(within(progressCell!).getByText("Speed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel Naturefilm-1.mkv" })).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Open source file" })).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Close job details" })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("transcode-job-1")).toHaveAttribute("aria-expanded", "true"));
    expect(screen.queryByText("Time range")).not.toBeInTheDocument();
    expect(screen.queryByText("Source → output")).not.toBeInTheDocument();
    expect(screen.queryByText("Hardware status")).not.toBeInTheDocument();
    expect(screen.getByText("Start time")).toBeInTheDocument();
    expect(screen.getByText("Duration so far")).toBeInTheDocument();
    expect(screen.getByText("ETA")).toBeInTheDocument();
    expect(screen.getByText("Codec")).toBeInTheDocument();
    expect(screen.getByText("Dynamic range")).toBeInTheDocument();
    expect(screen.getByText("H.264 / AVC")).toBeInTheDocument();
    expect(screen.getAllByText("H.265 / HEVC").length).toBeGreaterThan(0);
    expect(screen.getByText("SDR")).toBeInTheDocument();
    expect(screen.getAllByText("HDR10").length).toBeGreaterThan(0);
    const logDetails = screen.getByText("FFmpeg log").closest("details");
    expect(logDetails).toBeInTheDocument();
    expect(logDetails).not.toHaveAttribute("open");
    expect(screen.queryByText("Speed · last samples")).not.toBeInTheDocument();
    expect(screen.queryByText("Samples are collected while this page is open")).not.toBeInTheDocument();
    expect(screen.queryByText("/media/movies/Naturefilm-1.mkv")).not.toBeInTheDocument();
    expect(screen.getAllByTestId("echarts-react").length).toBeGreaterThan(0);
    const statusChart = screen.getAllByTestId("echarts-react").find((chart) => chart.getAttribute("data-tooltip-confine") === "true");
    expect(statusChart).toHaveAttribute("data-tooltip", "3,2×");
    expect(statusChart).toHaveAttribute("data-tooltip-render-mode", "html");
  });

  it("opens the clicked row and keeps the previous row closed", async () => {
    renderPage();

    const firstRow = await screen.findByTestId("transcode-job-1");
    const secondRow = screen.getByTestId("transcode-job-2");
    await waitFor(() => expect(firstRow).toHaveAttribute("aria-expanded", "true"));

    fireEvent.click(secondRow);

    expect(secondRow).toHaveAttribute("aria-expanded", "true");
    expect(firstRow).toHaveAttribute("aria-expanded", "false");
  });

  it("restores and persists resizable transcoding column widths", async () => {
    window.localStorage.setItem(
      TRANSCODING_COLUMN_WIDTHS_STORAGE_KEY,
      JSON.stringify({ file: 340 }),
    );
    renderPage();

    const resizeHandle = await screen.findByRole("button", { name: "Resize column File" });
    const headerCell = resizeHandle.closest("th") as HTMLTableCellElement | null;
    expect(headerCell).not.toBeNull();
    expect(headerCell).toHaveStyle({ width: "340px" });
    headerCell!.getBoundingClientRect = () =>
      ({
        x: 0,
        y: 0,
        width: 340,
        height: 42,
        top: 0,
        right: 340,
        bottom: 42,
        left: 0,
        toJSON: () => ({}),
      }) as DOMRect;

    fireEvent.pointerDown(resizeHandle, { clientX: 340 });
    fireEvent.pointerMove(window, { clientX: 420 });
    fireEvent.pointerUp(window);

    await waitFor(() =>
      expect(window.localStorage.getItem(TRANSCODING_COLUMN_WIDTHS_STORAGE_KEY)).toContain("\"file\":420"),
    );
  });

  it("cancels an active job through the existing runtime endpoint", async () => {
    const cancel = vi.spyOn(api, "cancelTranscodeJob").mockResolvedValue(createJob(1, { status: "canceled" }));
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Cancel Naturefilm-1.mkv" }));

    await waitFor(() => expect(cancel).toHaveBeenCalledWith(1));
  });

  it("queues several selected files with the chosen existing profile", async () => {
    const fileSearch = vi.spyOn(api, "fileSearch").mockResolvedValue({
      query: "",
      library_id: null,
      limit: 20,
      items: [
        { id: 10, library_id: 1, library_name: "Movies", library_type: "movies", filename: "Bulk-one.mkv", relative_path: "Bulk-one.mkv", size_bytes: 1_000_000, container: "mkv", duration: 120, quality_score: 7, video_codec: "h264", resolution: "1920x1080", hdr_type: "sdr" },
        { id: 11, library_id: 2, library_name: "Series", library_type: "series", filename: "Bulk-two.mkv", relative_path: "Bulk-two.mkv", size_bytes: 2_000_000, container: "mkv", duration: 180, quality_score: 8, video_codec: "hevc", resolution: "3840x2160", hdr_type: "hdr10" },
      ],
    });
    vi.spyOn(api, "fileTranscode").mockResolvedValue(createFileTranscode());
    const start = vi.spyOn(api, "startFileTranscode").mockResolvedValue(createJob(100));

    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Add jobs" }));
    expect(await screen.findByText("Bulk-one.mkv")).toBeInTheDocument();
    expect(fileSearch).toHaveBeenCalled();

    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[0]);
    fireEvent.click(checkboxes[1]);
    expect(screen.getByText("2 files selected")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Start 2 jobs" }));

    await waitFor(() => {
      expect(start).toHaveBeenCalledTimes(2);
      expect(start).toHaveBeenCalledWith(10, plan);
      expect(start).toHaveBeenCalledWith(11, plan);
    });
  });
});
