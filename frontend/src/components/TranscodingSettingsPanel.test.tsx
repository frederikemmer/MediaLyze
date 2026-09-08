import "../i18n";

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  api,
  type AppSettings,
  type TranscodeCapabilityMatrix,
  type TranscodeCapabilities,
  type TranscodeFederation,
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

const federation: TranscodeFederation = {
  settings: {
    enabled: false,
    federation_id: "federation-test",
    installation_id: "installation-test",
    federation_name: "Test federation",
    display_name: "Test installation",
    pairing_code: "123456",
    pairing_code_from_environment: false,
    pairing_code_expires_at: 0,
    discovery_enabled: false,
    accept_jobs: false,
    endpoint_urls: [],
    hostname_urls: ["http://medialyze-nas.local:8091"],
    ip_urls: ["http://192.168.1.20:8091"],
    resource_policy: {},
    protocol_version: 1,
    temp_budget_bytes: 0,
    result_retention_hours: 24,
  },
  members: [],
  discovered: [],
};

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

const federationWithMember: TranscodeFederation = {
  ...federation,
  members: [{
    id: 1,
    installation_id: "member-installation",
    federation_id: "federation-test",
    display_name: "Federick-PC",
    endpoint_urls: ["http://federick-pc:8091"],
    protocol_version: 1,
    status: "active",
    connection_status: "connected",
    reachable: true,
    accept_jobs: true,
    resources: { cpu_threads: 16 },
    capabilities: null,
    capability_matrix: {
      status: "completed",
      tested_at: "2026-09-04T12:00:00Z",
      ffmpeg_version: "ffmpeg version member",
      error: null,
      matrices: [{
        device_id: "cuda0",
        device_name: "NVIDIA GeForce RTX 3080",
        backend: "cuda",
        tested_at: "2026-09-04T12:00:00Z",
        decode_codecs: ["hevc"],
        encode_codecs: ["hevc"],
        cells: [{
          decode_codec: "hevc",
          encode_codec: "hevc",
          status: "hardware",
          decoder: "cuda:hevc",
          encoder: "hevc_nvenc",
          max_parallel_jobs: 2,
          max_parallel_jobs_is_lower_bound: false,
          detail: null,
        }],
      }],
    },
    active_jobs: 0,
    network_mbps: 1000,
    last_seen_at: "2026-09-04T12:00:00Z",
    last_sync_at: "2026-09-04T12:00:00Z",
    last_error: null,
  }],
};

describe("TranscodingSettingsPanel", () => {
  beforeEach(() => {
    vi.spyOn(api, "transcodeCapabilities").mockResolvedValue(capabilities);
    vi.spyOn(api, "transcodeCapabilityMatrix").mockResolvedValue(notRunMatrix);
    vi.spyOn(api, "testTranscodeCapabilityMatrix").mockResolvedValue(completedMatrix);
    vi.spyOn(api, "transcodeFederation").mockResolvedValue(federation);
    vi.spyOn(api, "transcodeProfiles").mockResolvedValue([]);
    vi.spyOn(api, "transcodeRules").mockResolvedValue([]);
    vi.spyOn(api, "libraries").mockResolvedValue([]);
    vi.spyOn(api, "updateAppSettings").mockResolvedValue(appSettings);
    vi.spyOn(api, "updateTranscodeFederation").mockResolvedValue(federation.settings);
    vi.spyOn(api, "discoverTranscodeFederation").mockResolvedValue(federation);
    vi.spyOn(api, "pairTranscodeFederation").mockResolvedValue(federation);
  });

  afterEach(() => {
    cleanup();
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
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

  it("shows a neutral empty state until the first capability matrix test", async () => {
    render(<TranscodingSettingsPanel settings={appSettings} appSettingsLoaded onUpdated={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "Accelerators" }));

    const emptyState = await screen.findByText("No capability matrix data yet. Run the hardware test to populate this matrix.");
    expect(emptyState.closest(".panel-empty-state")).not.toBeNull();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("places the federation toggle in the heading without redundant status guidance", async () => {
    vi.mocked(api.transcodeFederation).mockResolvedValueOnce({
      ...federation,
      discovered: [{
        installation_id: "discovered-installation",
        federation_id: "federation-test",
        display_name: "Discovered worker",
        endpoint_urls: ["http://worker:8091"],
        protocol_version: 1,
        reachable: true,
        last_seen_at: null,
      }],
    });
    vi.mocked(api.discoverTranscodeFederation).mockResolvedValue({
      ...federation,
      discovered: [{
        installation_id: "discovered-installation",
        federation_id: "federation-test",
        display_name: "Discovered worker",
        endpoint_urls: ["http://worker:8091"],
        protocol_version: 1,
        reachable: true,
        last_seen_at: null,
      }],
    });
    render(<TranscodingSettingsPanel settings={appSettings} appSettingsLoaded onUpdated={vi.fn()} />);

    expect(await screen.findByRole("heading", { name: "Federation" })).toBeInTheDocument();
    expect(screen.queryByText("Pair trusted MediaLyze installations directly and let compatible workers execute structured transcode plans without exposing library paths.")).not.toBeInTheDocument();
    const automationSection = document.querySelector("section.transcode-automation-section");
    const federationPanel = document.querySelector("section.transcode-federation-panel");
    expect(automationSection).not.toBeNull();
    expect(federationPanel).not.toBeNull();
    expect(federationPanel?.previousElementSibling).toBe(automationSection);

    const federationToggle = screen.getByRole("switch", { name: "Enable direct federation for this installation" });
    expect(federationToggle).not.toBeChecked();
    expect(federationToggle.closest("label")).toHaveClass("toggle-switch", "transcode-federation-toggle");
    expect(federationToggle.closest("label")).not.toHaveTextContent("Enable direct federation for this installation");
    expect(federationToggle.closest("label")?.querySelector(".toggle-switch-track .toggle-switch-thumb")).not.toBeNull();
    expect(federationToggle.closest(".transcode-federation-heading")).not.toBeNull();
    expect(screen.queryByText("Enabled")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Explain transcode federation" })).not.toBeInTheDocument();
    fireEvent.click(federationToggle);
    await waitFor(() => expect(api.updateTranscodeFederation).toHaveBeenCalledWith({ enabled: true }));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    const copyButton = screen.getByRole("button", { name: "Copy code" });
    const resetButton = screen.getByRole("button", { name: "Reset code" });
    expect(copyButton).toHaveClass("tooltip-trigger", "icon-only-button", "transcode-federation-address-copy");
    expect(copyButton.querySelector("svg")).toBeInTheDocument();
    expect(copyButton.closest(".transcode-federation-code")).not.toBeNull();
    expect(resetButton).toHaveClass("tooltip-trigger", "icon-only-button", "transcode-federation-code-action");
    expect(resetButton.querySelector("svg")).toBeInTheDocument();
    expect(resetButton.closest(".transcode-federation-code-heading")).not.toBeNull();
    expect(document.querySelector(".transcode-federation-code-group")?.closest(".transcode-federation-fields")).not.toBeNull();
    expect(document.querySelector(".transcode-federation-code-progress")).not.toBeNull();
    const addressCopyButtons = screen.getAllByRole("button", { name: "Copy address" });
    expect(addressCopyButtons).toHaveLength(2);
    for (const addressCopyButton of addressCopyButtons) {
      expect(addressCopyButton).toHaveClass("tooltip-trigger", "icon-only-button", "transcode-federation-address-copy");
      expect(addressCopyButton.querySelector("svg")).toBeInTheDocument();
    }
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    fireEvent.click(addressCopyButtons[0]);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("http://medialyze-nas.local:8091"));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    fireEvent.click(copyButton);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("123456"));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    const connectButtons = screen.getAllByRole("button", { name: "Connect" });
    expect(connectButtons).toHaveLength(2);
    for (const connectButton of connectButtons) {
      expect(connectButton).toHaveClass("secondary", "small", "settings-panel-header-action", "transcode-federation-connect-button");
      expect(connectButton.querySelector("svg")).toBeInTheDocument();
    }
    const discoveredCodeInput = document.querySelector(".transcode-federation-peer-code-input") as HTMLInputElement;
    expect(discoveredCodeInput).not.toBeNull();
    expect(discoveredCodeInput).toHaveAttribute("placeholder", "Pairing code");
    expect(discoveredCodeInput).toHaveAttribute("aria-label", "Pairing code");
    expect(screen.queryByRole("button", { name: "Pair" })).not.toBeInTheDocument();
    expect(screen.getByText("Reachable network addresses")).toBeInTheDocument();
    expect(screen.queryByText("Pairing is direct; members are not used as relays.")).not.toBeInTheDocument();
    expect(screen.queryByText("Hostname")).not.toBeInTheDocument();
    expect(screen.queryByText("IP address")).not.toBeInTheDocument();
    expect(screen.queryByText("Respond to direct LAN discovery")).not.toBeInTheDocument();
    expect(screen.queryByText("Accept remote jobs on this installation")).not.toBeInTheDocument();
    expect(screen.queryByText("Foreign-job resources")).not.toBeInTheDocument();
    expect(screen.queryByText("Allow foreign CPU jobs")).not.toBeInTheDocument();
    expect(screen.queryByText(/Stable installation ID:/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Discover on LAN" })).not.toBeInTheDocument();
    expect(screen.queryByText("Discovered installations")).not.toBeInTheDocument();
    const discoveredPanel = screen.getByText("Found in Network").closest(".transcode-federation-discovered");
    expect(discoveredPanel).not.toBeNull();
    expect(discoveredPanel?.querySelector(".transcode-federation-discovered-list")).not.toBeNull();
    const refreshDiscoveryButton = screen.getByRole("button", { name: "Refresh discovery" });
    expect(refreshDiscoveryButton).toHaveClass("tooltip-trigger", "icon-only-button", "compatibility-profile-quick-action", "transcode-federation-discovered-refresh");
    fireEvent.click(refreshDiscoveryButton);
    await waitFor(() => expect(api.discoverTranscodeFederation).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("Add trusted installation")).not.toBeInTheDocument();
    const pairing = discoveredPanel?.parentElement;
    const manualPairForm = pairing?.querySelector(".transcode-federation-pair-form");
    expect(manualPairForm).not.toBeNull();
    expect(pairing?.firstElementChild).toBe(discoveredPanel);
    expect(pairing?.lastElementChild).toBe(manualPairForm);
    expect(screen.getByText("http://medialyze-nas.local:8091")).toBeInTheDocument();
    expect(screen.getByText("http://192.168.1.20:8091")).toBeInTheDocument();
    expect(screen.getByText("Discovered worker")).toBeInTheDocument();
    expect(screen.getAllByText("http://worker:8091")).toHaveLength(1);
    const discoveredConnectButton = discoveredPanel?.querySelector("button.transcode-federation-connect-button");
    expect(discoveredConnectButton).not.toBeNull();
    fireEvent.click(discoveredConnectButton as HTMLButtonElement);
    expect(discoveredCodeInput).toHaveClass("is-invalid");
    expect(discoveredCodeInput).toHaveAttribute("aria-invalid", "true");
    await waitFor(() => expect(discoveredCodeInput).not.toHaveClass("is-invalid"), { timeout: 1500 });
    expect(discoveredCodeInput).toHaveAttribute("aria-invalid", "false");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    fireEvent.change(discoveredCodeInput, { target: { value: "12a3456" } });
    expect(discoveredCodeInput).toHaveValue("123456");
    fireEvent.click(discoveredConnectButton as HTMLButtonElement);
    await waitFor(() => expect(api.pairTranscodeFederation).toHaveBeenCalledWith({ endpoint: "http://worker:8091", pairing_code: "123456" }));

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

  it("lists tested federation hardware in Accelerators with a member pill", async () => {
    vi.mocked(api.transcodeFederation).mockResolvedValueOnce(federationWithMember);
    vi.mocked(api.transcodeCapabilityMatrix).mockResolvedValueOnce(completedMatrix);
    render(<TranscodingSettingsPanel settings={appSettings} appSettingsLoaded onUpdated={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "Accelerators" }));

    const matrices = await screen.findAllByRole("table");
    expect(matrices).toHaveLength(3);
    const memberPill = document.querySelector(".transcode-federation-member-pill");
    expect(memberPill).not.toBeNull();
    expect(memberPill).toHaveTextContent("Federick-PC");
    expect(memberPill?.closest("details.transcode-device-matrix")).not.toBeNull();
    expect(screen.queryByText(/Hardware capability matrix/)).not.toBeInTheDocument();
  });

  it("shows federation members in the shared automation toggle", async () => {
    vi.mocked(api.transcodeFederation).mockResolvedValueOnce(federationWithMember);
    render(<TranscodingSettingsPanel settings={appSettings} appSettingsLoaded onUpdated={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "Members" }));

    expect(await screen.findByText("Federick-PC")).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "Search federation members" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sync Federick-PC" })).toHaveClass("compatibility-profile-quick-action");
    expect(screen.getByRole("button", { name: "Exclude Federick-PC" })).toHaveClass("compatibility-profile-quick-action");
    expect(document.querySelector(".transcode-federation-members")).toBeNull();

    fireEvent.click(screen.getByText("Federick-PC"));
    expect(await screen.findByDisplayValue("http://federick-pc:8091")).toBeInTheDocument();
    expect(screen.getByDisplayValue("connected")).toBeInTheDocument();
    expect(screen.getByText("Accept remote transcode jobs")).toBeInTheDocument();
  });
});
