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
  selected_devices: "auto",
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
      { decode_codec: "hevc", encode_codec: "hevc", status: "hardware", decoder: "cuda:hevc", encoder: "hevc_nvenc", max_parallel_jobs: 4, max_parallel_jobs_is_lower_bound: true, detail: null },
      { decode_codec: "hevc", encode_codec: "av1", status: "hardware", decoder: "cuda:hevc", encoder: "av1_nvenc", max_parallel_jobs: 3, max_parallel_jobs_is_lower_bound: false, detail: null },
      { decode_codec: "av1", encode_codec: "hevc", status: "software", decoder: "software:auto", encoder: "libx265", max_parallel_jobs: null, max_parallel_jobs_is_lower_bound: false, detail: null },
      { decode_codec: "av1", encode_codec: "av1", status: "unsupported", decoder: null, encoder: null, max_parallel_jobs: null, max_parallel_jobs_is_lower_bound: false, detail: null },
    ],
  }],
};

describe("TranscodingSettingsPanel", () => {
  beforeEach(() => {
    vi.spyOn(api, "transcodeCapabilities").mockResolvedValue(capabilities);
    vi.spyOn(api, "transcodeCapabilityMatrix").mockResolvedValue(notRunMatrix);
    vi.spyOn(api, "testTranscodeCapabilityMatrix").mockResolvedValue(completedMatrix);
    vi.spyOn(api, "updateAppSettings").mockResolvedValue(appSettings);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("selects one physical device while grouping its backend paths", async () => {
    render(<TranscodingSettingsPanel settings={appSettings} appSettingsLoaded onUpdated={vi.fn()} />);

    const select = await screen.findByRole("combobox", { name: "Hardware device" });
    expect(select).toHaveValue("auto");

    const section = select.closest("section") as HTMLElement;
    expect(within(section).queryByRole("radio")).not.toBeInTheDocument();
    expect(within(section).queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Intel GPU (renderD128) · 8086:56A6" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Quick Sync/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /VAAPI/ })).not.toBeInTheDocument();

    fireEvent.change(select, { target: { value: "render:/dev/dri/renderD128" } });
    expect(select).toHaveValue("render:/dev/dri/renderD128");
    fireEvent.click(screen.getByRole("button", { name: "Save transcoding settings" }));

    await waitFor(() => expect(api.updateAppSettings).toHaveBeenCalledWith(expect.objectContaining({
      transcoding: expect.objectContaining({
        selected_devices: ["qsv-renderD128", "vaapi-renderD128"],
      }),
    })));
  });

  it("starts the matrix test and renders directed hardware, software, and unavailable cells", async () => {
    render(<TranscodingSettingsPanel settings={appSettings} appSettingsLoaded onUpdated={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "Test codec matrix" }));

    await waitFor(() => expect(api.testTranscodeCapabilityMatrix).toHaveBeenCalledTimes(1));
    const matrix = await screen.findByRole("table");
    expect(within(matrix).getByLabelText(/H\.265 \/ HEVC → AV1: HW · 3×/)).toBeInTheDocument();
    expect(within(matrix).getByLabelText(/AV1 → H\.265 \/ HEVC: CPU/)).toBeInTheDocument();
    expect(within(matrix).getByLabelText(/AV1 → AV1: —/)).toBeInTheDocument();
    expect(screen.getByText("Hardware · simultaneous sessions")).toBeInTheDocument();
  });
});
