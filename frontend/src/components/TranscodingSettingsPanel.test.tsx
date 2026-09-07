import "../i18n";

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  api,
  type AppSettings,
  type TranscodeCapabilityMatrix,
  type TranscodeCapabilities,
  type TranscodeHardwareDevice,
  type TranscodingSettings,
} from "../lib/api";
import { TranscodingSettingsPanel } from "./TranscodingSettingsPanel";

const transcodingSettings: TranscodingSettings = {
  execution_mode: "hardware_required",
  cpu_budget_percent: 90,
  cpu_parallel_jobs: "auto",
  gpu_parallel_jobs_per_device: 1,
  default_output_mode: "transcode_output",
  on_error: "continue",
  retry_count: 0,
  existing_output: "fail",
  remove_partial_output: true,
};

const appSettings = { transcoding: transcodingSettings } as AppSettings;

function device(overrides: Partial<TranscodeHardwareDevice>): TranscodeHardwareDevice {
  return {
    id: "cuda0",
    name: "NVIDIA GeForce RTX 3080",
    vendor: "nvidia",
    backend: "cuda",
    driver_version: null,
    compute_capability: null,
    memory_total_bytes: null,
    render_node: null,
    device_class: "dedicated",
    decoder_codecs: [],
    encoder_names: [],
    encoder_codecs: [],
    supported_pixel_formats: [],
    supported_filters: [],
    status: "available",
    failure_reason: null,
    last_tested_at: null,
    ...overrides,
  };
}

const capabilities: TranscodeCapabilities = {
  ffmpeg_available: true,
  ffmpeg_path: "ffmpeg",
  version: "ffmpeg version test",
  containers: ["mkv", "mp4", "webm"],
  encoders: [],
  devices: [
    device({
      id: "qsv-renderD128",
      name: "Intel GPU (renderD128) · 8086:56A6 · Quick Sync",
      vendor: "intel",
      backend: "qsv",
      render_node: "/dev/dri/renderD128",
    }),
    device({
      id: "vaapi-renderD128",
      name: "Intel GPU (renderD128) · 8086:56A6 · VAAPI",
      vendor: "intel",
      backend: "vaapi",
      render_node: "/dev/dri/renderD128",
    }),
    device({ id: "cuda0" }),
  ],
  decoder_codecs: [],
  platform: "linux",
  last_tested_at: null,
  dolby_vision_passthrough: false,
  error: null,
};

const notRunMatrix: TranscodeCapabilityMatrix = {
  status: "not_run",
  tested_at: null,
  ffmpeg_version: null,
  matrices: [],
  error: null,
};

const completedMatrix: TranscodeCapabilityMatrix = {
  status: "completed",
  tested_at: "2026-09-04T12:00:00Z",
  ffmpeg_version: "ffmpeg version test",
  error: null,
  matrices: [{
    device_id: "cuda0",
    device_name: "NVIDIA GeForce RTX 3080",
    backend: "cuda",
    tested_at: "2026-09-04T12:00:00Z",
    decode_codecs: ["hevc", "av1"],
    encode_codecs: ["hevc", "av1"],
    cells: [
      {
        decode_codec: "hevc",
        encode_codec: "hevc",
        status: "hardware",
        decoder: "cuda:hevc",
        encoder: "hevc_nvenc",
        max_parallel_jobs: 4,
        max_parallel_jobs_is_lower_bound: true,
        parallel_benchmark: {
          tolerance_percent: 20,
          test_ceiling: 8,
          repetitions: 3,
          width: 256,
          height: 256,
          frame_rate: 30,
          frames: 240,
          stream_loops: 7,
          baseline_median_seconds: 0.25,
          slowdown_limit_seconds: 0.3,
          levels: [
            {
              concurrency: 1,
              runs: [
                { run: 1, duration_seconds: 0.25, success: true, error: null },
                { run: 2, duration_seconds: 0.24, success: true, error: null },
                { run: 3, duration_seconds: 0.26, success: true, error: null },
              ],
              median_seconds: 0.25,
              slowdown_percent: 0,
              passed: true,
              error: null,
            },
            {
              concurrency: 4,
              runs: [
                { run: 1, duration_seconds: 0.28, success: true, error: null },
                { run: 2, duration_seconds: 0.29, success: true, error: null },
                { run: 3, duration_seconds: 0.28, success: true, error: null },
              ],
              median_seconds: 0.28,
              slowdown_percent: 12,
              passed: true,
              error: null,
            },
          ],
        },
        detail: null,
      },
      { decode_codec: "hevc", encode_codec: "av1", status: "hardware", decoder: "cuda:hevc", encoder: "av1_nvenc", max_parallel_jobs: 3, max_parallel_jobs_is_lower_bound: false, detail: null },
      { decode_codec: "av1", encode_codec: "hevc", status: "software", decoder: "software:auto", encoder: "libx265", max_parallel_jobs: null, max_parallel_jobs_is_lower_bound: false, detail: null },
      { decode_codec: "av1", encode_codec: "av1", status: "unsupported", decoder: null, encoder: null, max_parallel_jobs: null, max_parallel_jobs_is_lower_bound: false, detail: null },
    ],
  }, {
    device_id: "render:/dev/dri/renderD128",
    device_name: "Intel CPU iGPU · Quick Sync",
    backend: "qsv + vaapi",
    tested_at: "2026-09-04T12:00:00Z",
    decode_codecs: ["hevc"],
    encode_codecs: ["av1"],
    cells: [
      { decode_codec: "hevc", encode_codec: "av1", status: "software", decoder: "software:auto", encoder: "libsvtav1", max_parallel_jobs: null, max_parallel_jobs_is_lower_bound: false, detail: null },
    ],
  }],
};

describe("TranscodingSettingsPanel", () => {
  beforeEach(() => {
    vi.spyOn(api, "transcodeCapabilities").mockResolvedValue(capabilities);
    vi.spyOn(api, "transcodeCapabilityMatrix").mockResolvedValue(notRunMatrix);
    vi.spyOn(api, "testTranscodeCapabilityMatrix").mockResolvedValue(completedMatrix);
    vi.spyOn(api, "transcodeProfiles").mockResolvedValue([]);
    vi.spyOn(api, "transcodeRules").mockResolvedValue([]);
    vi.spyOn(api, "libraries").mockResolvedValue([]);
    vi.spyOn(api, "updateAppSettings").mockResolvedValue(appSettings);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("does not expose a global hardware-device selector", async () => {
    render(<TranscodingSettingsPanel settings={appSettings} appSettingsLoaded onUpdated={vi.fn()} />);

    expect(await screen.findByRole("heading", { name: "Transcoding" })).toBeInTheDocument();
    await screen.findByRole("button", { name: "Test Hardware" });
    expect(screen.queryByRole("combobox", { name: "Hardware device" })).not.toBeInTheDocument();
    expect(screen.queryByText("Hardware device")).not.toBeInTheDocument();

    const executionMode = screen.getByRole("combobox", { name: "Execution mode" });
    fireEvent.change(executionMode, { target: { value: "cpu_only" } });
    await waitFor(() => expect(api.updateAppSettings).toHaveBeenCalled());
    const payload = vi.mocked(api.updateAppSettings).mock.calls[0]?.[0];
    expect(payload?.transcoding).not.toHaveProperty("selected_devices");
  });

  it("starts the matrix test and renders directed hardware, software, and unavailable cells", async () => {
    render(<TranscodingSettingsPanel settings={appSettings} appSettingsLoaded onUpdated={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "Test Hardware" }));

    await waitFor(() => expect(api.testTranscodeCapabilityMatrix).toHaveBeenCalledTimes(1));
    fireEvent.click(await screen.findByRole("button", { name: "Accelerators" }));
    const matrices = await screen.findAllByRole("table");
    const matrix = matrices[0];
    expect(within(matrix).getByLabelText(/H\.265 \/ HEVC → AV1: HW · 3×/)).toBeInTheDocument();
    expect(within(matrix).getByLabelText(/AV1 → H\.265 \/ HEVC: Software/)).toBeInTheDocument();
    expect(within(matrix).getByLabelText(/AV1 → AV1: —/)).toBeInTheDocument();
    const corner = matrix.querySelector(".transcode-matrix-corner") as HTMLElement;
    expect(corner).not.toBeNull();
    expect(corner.querySelector(".transcode-matrix-axis-label-horizontal")).toHaveTextContent("Encode");
    expect(corner.querySelector(".transcode-matrix-axis-label-vertical")).toHaveTextContent("Decode");
    expect(corner).not.toHaveTextContent("↓");
    expect(corner).not.toHaveTextContent("→");
    expect(document.querySelectorAll(".transcode-matrix-legend")).toHaveLength(0);
    expect(within(matrix).queryByText("Decode vertically · encode horizontally")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Transcoding capability matrix" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Transcoding capability matrix" })).not.toBeInTheDocument();
    const metadataTrigger = screen.getByRole("button", { name: "Explain accelerators" });
    fireEvent.click(metadataTrigger);
    const metadataTooltip = await screen.findByRole("tooltip");
    expect(metadataTooltip).toHaveTextContent("FFmpeg: ffmpeg version test");
    expect(metadataTooltip).toHaveTextContent("Hardware counts use a representative codec pair");
    expect(screen.getByText("Intel CPU iGPU · Quick Sync")).toBeInTheDocument();
    expect(screen.getByText("qsv + vaapi · renderD128")).toBeInTheDocument();
    expect(screen.getByText("NVIDIA GeForce RTX 3080").closest(".transcode-capability-device-copy")).not.toBeNull();
    expect(matrices).toHaveLength(2);
    const matrixSection = document.querySelector("section.transcode-capability-section");
    expect(matrixSection).not.toBeNull();
    expect(matrixSection?.closest(".transcode-automation-content")).not.toBeNull();
    expect(matrixSection?.querySelector("details.transcode-capability-matrix")).toBeNull();
    expect(screen.getByRole("searchbox", { name: "Search hardware devices" })).toBeInTheDocument();

    fireEvent.click(within(matrix).getByLabelText(/H\.265 \/ HEVC → H\.265 \/ HEVC: HW · 4\+×/));
    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip).not.toHaveTextContent("Parallel benchmark");
    expect(tooltip).not.toHaveTextContent("Runs per level: 3");
    expect(tooltip).not.toHaveTextContent("Pass: median per-session runtime");
    expect(tooltip).not.toHaveTextContent("Each run reports the median elapsed time");
    expect(tooltip).not.toHaveTextContent("Result");
    expect(tooltip).toHaveTextContent("Decoder: cuda:hevc");
    expect(tooltip).toHaveTextContent("Encoder: hevc_nvenc");
    expect(tooltip.querySelector(".transcode-matrix-tooltip-path-arrow")).toHaveTextContent("→");
    expect(tooltip).toHaveTextContent("Run 1: 0.250 s");
    expect(tooltip).toHaveTextContent("4 sessions");
    expect(tooltip).toHaveTextContent("+12.0 %");
  });
});
