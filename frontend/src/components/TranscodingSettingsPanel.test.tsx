import i18n from "../i18n";

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
import {
  buildTranscodingMatrixAnchorId,
  buildTranscodingMatrixEntryKey,
  TRANSCODING_MATRIX_EXPANSION_STORAGE_KEY,
} from "../lib/transcoding-matrix-state";
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
    device_class: "dedicated",
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
    device_class: "integrated",
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
    application_version: "0.18.0-dev042",
    status: "active",
    connection_status: "connected",
    reachable: true,
    accept_jobs: true,
    resources: { cpu_threads: 16, temp_free_bytes: 125 * 1024 * 1024 * 1024 },
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
        device_class: "dedicated",
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

const federationWithMemberCapabilities: TranscodeFederation = {
  ...federationWithMember,
  members: [{
    ...federationWithMember.members[0],
    capabilities: {
      ...capabilities,
      devices: [device({ id: "cuda0" })],
    },
    capability_matrix: {
      ...federationWithMember.members[0].capability_matrix!,
      matrices: [{
        ...federationWithMember.members[0].capability_matrix!.matrices[0],
        device_id: "device:cuda0",
      }],
    },
  }],
};

const federationWithPendingMembers: TranscodeFederation = {
  ...federationWithMember,
  settings: { ...federationWithMember.settings, enabled: true },
  members: [
    { ...federationWithMember.members[0], capability_matrix: null },
    {
      ...federationWithMember.members[0],
      id: 2,
      installation_id: "not-run-installation",
      display_name: "Not run PC",
      endpoint_urls: ["http://not-run-pc:8091"],
      capability_matrix: notRunMatrix,
    },
    {
      ...federationWithMember.members[0],
      id: 3,
      installation_id: "completed-installation",
      display_name: "Completed PC",
    },
  ],
};

describe("TranscodingSettingsPanel", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
    window.localStorage.clear();
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
    vi.spyOn(api, "testTranscodeFederationNetwork").mockResolvedValue(federation);
    vi.spyOn(api, "testTranscodeFederationMemberCapabilityMatrix").mockResolvedValue(federation);
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
    expect(screen.queryByLabelText("GPU jobs per device")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Retries")).not.toBeInTheDocument();
    const profileList = document.querySelector(".compatibility-profile-list");
    expect(profileList?.querySelector(".transcode-automation-toggle-row")).not.toBeNull();
    expect(screen.getByRole("button", { name: "New profile" }).closest(".transcode-automation-toggle-row")).not.toBeNull();

    const executionMode = screen.getByRole("combobox", { name: "Execution mode" });
    const removePartialOutput = screen.getByRole("combobox", { name: "Partial output" });
    expect(screen.getByRole("spinbutton", { name: "CPU budget (%)" })).toHaveClass("settings-choice-input");
    expect(executionMode).toHaveClass("settings-choice-input");
    expect(removePartialOutput).toHaveValue("yes");
    expect(removePartialOutput).toHaveTextContent("Remove");
    expect(removePartialOutput).toHaveTextContent("Keep");
    expect(removePartialOutput.closest(".app-settings-performance-grid")).not.toBeNull();
    fireEvent.change(executionMode, { target: { value: "cpu_only" } });
    await waitFor(() => expect(api.updateAppSettings).toHaveBeenCalled());
    const payload = vi.mocked(api.updateAppSettings).mock.calls[0]?.[0];
    expect(payload?.transcoding).not.toHaveProperty("selected_devices");
    fireEvent.change(removePartialOutput, { target: { value: "no" } });
    await waitFor(() => expect(api.updateAppSettings).toHaveBeenCalledWith({
      transcoding: expect.objectContaining({ remove_partial_output: false }),
    }));
  });

  it("shows a neutral empty state until the first capability matrix test", async () => {
    render(<TranscodingSettingsPanel settings={appSettings} appSettingsLoaded onUpdated={vi.fn()} />);

    fireEvent.click(await screen.findByRole("tab", { name: "Accelerators" }));

    const emptyState = await screen.findByText("No capability matrix data yet. Run the hardware test to populate this matrix.");
    expect(emptyState.closest(".panel-empty-state")).not.toBeNull();
    expect(emptyState.closest(".compatibility-profile-list")).not.toBeNull();
    expect(emptyState.closest(".compatibility-profile-list")?.querySelector(".transcode-automation-toggle-row")).not.toBeNull();
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
        application_version: "0.17.9",
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
        application_version: "0.17.9",
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
    const federationDisclosure = screen.getByRole("button", { name: "Collapse Federation" });
    expect(federationDisclosure).toHaveClass("transcode-federation-section-chevron");
    expect(federationDisclosure).toHaveAttribute("title", "Collapse Federation");
    expect(federationDisclosure.firstElementChild).toHaveClass("nav-icon");
    expect(federationDisclosure.querySelector("h3")).toBeNull();
    const federationHeading = screen.getByRole("heading", { name: "Federation" });
    expect(federationDisclosure.nextElementSibling).toBe(federationToggle.closest("label"));
    expect(federationToggle.closest("label")?.nextElementSibling).toBe(federationHeading);
    expect(screen.queryByText("Federation name")).not.toBeInTheDocument();
    expect(screen.getByText("Test installation")).toHaveClass("transcode-federation-installation-name");
    const editDisplayNameButton = screen.getByRole("button", { name: "Edit: Installation name" });
    expect(editDisplayNameButton).toHaveClass("transcode-federation-name-action");
    fireEvent.click(editDisplayNameButton);
    const displayNameInput = screen.getByRole("textbox", { name: "Edit: Installation name" });
    expect(displayNameInput).toHaveValue("Test installation");
    fireEvent.change(displayNameInput, { target: { value: "Renamed installation" } });
    vi.mocked(api.updateTranscodeFederation).mockResolvedValueOnce({ ...federation.settings, display_name: "Renamed installation" });
    fireEvent.click(screen.getByRole("button", { name: "Save: Installation name" }));
    await waitFor(() => expect(api.updateTranscodeFederation).toHaveBeenCalledWith({ display_name: "Renamed installation" }));
    expect(screen.getByText("Renamed installation")).toHaveClass("transcode-federation-installation-name");
    expect(federationDisclosure).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(federationDisclosure);
    expect(federationDisclosure).toHaveAttribute("aria-expanded", "false");
    expect(federationDisclosure).toHaveAttribute("aria-label", "Expand Federation");
    expect(screen.getByText("123456")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy code" })).toBeInTheDocument();
    expect(screen.queryByText("Reachable network addresses")).not.toBeInTheDocument();
    fireEvent.click(federationDisclosure);
    expect(federationDisclosure).toHaveAttribute("aria-expanded", "true");
    expect(screen.queryByText("Enabled")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Explain transcode federation" })).not.toBeInTheDocument();
    fireEvent.click(federationToggle);
    await waitFor(() => expect(api.updateTranscodeFederation).toHaveBeenCalledWith({ enabled: true }));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    const copyButton = screen.getByRole("button", { name: "Copy code" });
    const resetButton = screen.getByRole("button", { name: "Reset code" });
    expect(copyButton).toHaveClass("tooltip-trigger", "icon-only-button", "transcode-federation-address-copy");
    expect(copyButton.querySelector("svg")).toBeInTheDocument();
    expect(copyButton.closest(".transcode-federation-header-code")).not.toBeNull();
    expect(resetButton).toHaveClass("tooltip-trigger", "icon-only-button", "transcode-federation-code-action");
    expect(resetButton.querySelector("svg")).toBeInTheDocument();
    expect(resetButton.closest(".transcode-federation-code-summary")).not.toBeNull();
    expect(document.querySelector(".transcode-federation-addresses")?.closest(".transcode-federation-content")).not.toBeNull();
    expect(document.querySelector(".transcode-federation-fields")).toBeNull();
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
    fireEvent.click(await screen.findByRole("tab", { name: "Members" }));
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
    const discoveredPeer = document.querySelector(".transcode-federation-peer");
    expect(discoveredPeer).toHaveClass("compatibility-profile-list-item");
    expect(discoveredPeer?.closest(".compatibility-profile-list")).not.toBeNull();
    expect(discoveredPeer?.closest(".transcode-federation-panel")).toBeNull();
    expect(document.querySelector(".transcode-federation-discovered")).toBeNull();
    const refreshDiscoveryButton = screen.getByRole("button", { name: "Refresh discovery" });
    expect(refreshDiscoveryButton).toHaveClass("tooltip-trigger", "icon-only-button", "compatibility-profile-quick-action", "transcode-federation-discovered-refresh");
    expect(refreshDiscoveryButton.closest(".transcode-automation-toggle-row")).not.toBeNull();
    fireEvent.click(refreshDiscoveryButton);
    await waitFor(() => expect(api.discoverTranscodeFederation).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("Add trusted installation")).not.toBeInTheDocument();
    const manualPairControl = document.querySelector(".transcode-federation-manual-connect-control");
    expect(manualPairControl).not.toBeNull();
    const manualItem = manualPairControl?.closest(".transcode-federation-manual-item") as HTMLElement;
    expect(manualItem).not.toBeNull();
    expect(manualPairControl?.closest(".compatibility-profile-list")).not.toBeNull();
    expect(manualItem.querySelector(":scope > .transcode-federation-add-icon")).not.toBeNull();
    const manualEndpointInput = within(manualItem).getByRole("textbox", { name: "http://host:8091" });
    const manualCodeInput = within(manualItem).getByRole("textbox", { name: "Pairing code" });
    fireEvent.change(manualEndpointInput, { target: { value: "http://manual-worker:8091" } });
    fireEvent.click(within(manualItem).getByRole("button", { name: "Connect" }));
    expect(manualCodeInput).toHaveClass("is-invalid");
    expect(manualCodeInput).toHaveAttribute("aria-invalid", "true");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("http://medialyze-nas.local:8091")).toBeInTheDocument();
    expect(screen.getByText("http://192.168.1.20:8091")).toBeInTheDocument();
    expect(screen.getByText("Discovered worker")).toBeInTheDocument();
    expect(screen.getByText("http://worker:8091 · v0.17.9")).toBeInTheDocument();
    const discoveredConnectButton = discoveredPeer?.querySelector("button.transcode-federation-connect-button");
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

  it("explains when the local federation listener is unavailable", async () => {
    vi.mocked(api.transcodeFederation).mockResolvedValueOnce({
      ...federation,
      settings: {
        ...federation.settings,
        listener_status: "error",
        listener_port: 8091,
        listener_error: "Federation listener is unavailable on port 8091: the port is already in use by another process.",
      },
    });

    render(<TranscodingSettingsPanel settings={appSettings} appSettingsLoaded onUpdated={vi.fn()} />);

    const warning = await screen.findByRole("alert");
    expect(warning).toHaveTextContent("Federation listener unavailable");
    expect(warning).toHaveTextContent("port 8091");
    expect(warning).toHaveTextContent("already in use by another process");
  });

  it("starts the matrix test and renders directed hardware, software, and unavailable cells", async () => {
    render(<TranscodingSettingsPanel settings={appSettings} appSettingsLoaded onUpdated={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "Test Hardware" }));

    await waitFor(() => expect(api.testTranscodeCapabilityMatrix).toHaveBeenCalledTimes(1));
    fireEvent.click(await screen.findByRole("tab", { name: "Accelerators" }));
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
    expect(screen.getByText("qsv + vaapi")).toBeInTheDocument();
    expect(screen.queryByText("qsv + vaapi · renderD128")).not.toBeInTheDocument();
    expect(screen.queryByText("cuda · cuda0")).not.toBeInTheDocument();
    expect(screen.getByText("NVIDIA GeForce RTX 3080").closest(".transcode-capability-device-copy")).not.toBeNull();
    expect(matrices).toHaveLength(2);
    const matrixSection = document.querySelector("section.transcode-capability-section");
    expect(matrixSection).not.toBeNull();
    expect(matrixSection?.closest(".transcode-automation-content")).not.toBeNull();
    expect(matrixSection?.querySelector("details.transcode-capability-matrix")).toBeNull();
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();

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

  it("asks every active connected federation member to refresh its matrix when needed", async () => {
    vi.mocked(api.transcodeFederation).mockResolvedValueOnce(federationWithPendingMembers);
    vi.mocked(api.testTranscodeFederationMemberCapabilityMatrix).mockResolvedValue(federationWithPendingMembers);
    render(<TranscodingSettingsPanel settings={appSettings} appSettingsLoaded onUpdated={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "Test Hardware" }));

    await waitFor(() => expect(api.testTranscodeCapabilityMatrix).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(api.testTranscodeFederationMemberCapabilityMatrix).toHaveBeenCalledTimes(3));
    expect(api.testTranscodeFederationMemberCapabilityMatrix).toHaveBeenNthCalledWith(1, "member-installation");
    expect(api.testTranscodeFederationMemberCapabilityMatrix).toHaveBeenNthCalledWith(2, "not-run-installation");
    expect(api.testTranscodeFederationMemberCapabilityMatrix).toHaveBeenNthCalledWith(3, "completed-installation");
  });

  it("only shows the federation network test for an active connected member", async () => {
    vi.mocked(api.transcodeFederation).mockResolvedValueOnce(federationWithMember);
    render(<TranscodingSettingsPanel settings={appSettings} appSettingsLoaded onUpdated={vi.fn()} />);

    await screen.findByRole("heading", { name: "Federation" });
    expect(screen.queryByRole("button", { name: "Test network" })).not.toBeInTheDocument();

    cleanup();
    vi.mocked(api.transcodeFederation).mockResolvedValueOnce({
      ...federationWithMember,
      settings: { ...federationWithMember.settings, enabled: true },
      members: [{
        ...federationWithMember.members[0],
        connection_status: "offline",
        reachable: false,
      }],
    });
    render(<TranscodingSettingsPanel settings={appSettings} appSettingsLoaded onUpdated={vi.fn()} />);

    await screen.findByRole("heading", { name: "Federation" });
    expect(screen.queryByRole("button", { name: "Test network" })).not.toBeInTheDocument();
  });

  it("runs the federation network test for every connected installation", async () => {
    vi.mocked(api.transcodeFederation).mockResolvedValueOnce(federationWithPendingMembers);
    vi.mocked(api.testTranscodeFederationNetwork).mockResolvedValueOnce(federationWithPendingMembers);
    render(<TranscodingSettingsPanel settings={appSettings} appSettingsLoaded onUpdated={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "Test network" }));

    await waitFor(() => expect(api.testTranscodeFederationNetwork).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole("status")).toHaveTextContent("Federation connections tested.");
  });

  it("remembers the expanded accelerator devices", async () => {
    render(<TranscodingSettingsPanel settings={appSettings} appSettingsLoaded onUpdated={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "Test Hardware" }));
    await waitFor(() => expect(api.testTranscodeCapabilityMatrix).toHaveBeenCalledTimes(1));
    fireEvent.click(await screen.findByRole("tab", { name: "Accelerators" }));

    const initialMatrices = await screen.findAllByRole("table");
    expect(initialMatrices).toHaveLength(2);
    const initialDeviceEntries = document.querySelectorAll("details.transcode-device-matrix");
    expect(initialDeviceEntries).toHaveLength(2);
    expect(initialDeviceEntries[0]).toHaveAttribute("open");
    expect(initialDeviceEntries[1]).not.toHaveAttribute("open");

    fireEvent.click(initialDeviceEntries[0].querySelector("summary")!);
    fireEvent.click(initialDeviceEntries[1].querySelector("summary")!);
    await waitFor(() => expect(JSON.parse(window.localStorage.getItem(TRANSCODING_MATRIX_EXPANSION_STORAGE_KEY) ?? "{}")).toMatchObject({
      [buildTranscodingMatrixEntryKey(null, "cuda0")]: false,
      [buildTranscodingMatrixEntryKey(null, "render:/dev/dri/renderD128")]: true,
    }));

    fireEvent.click(screen.getByRole("tab", { name: "Profiles" }));
    fireEvent.click(screen.getByRole("tab", { name: "Accelerators" }));
    await screen.findAllByRole("table");

    const restoredDeviceEntries = document.querySelectorAll("details.transcode-device-matrix");
    expect(restoredDeviceEntries[0]).not.toHaveAttribute("open");
    expect(restoredDeviceEntries[1]).toHaveAttribute("open");
  });

  it("lists tested federation hardware in Accelerators with a member pill", async () => {
    vi.mocked(api.transcodeFederation).mockResolvedValueOnce(federationWithMember);
    vi.mocked(api.transcodeCapabilityMatrix).mockResolvedValueOnce(completedMatrix);
    render(<TranscodingSettingsPanel settings={appSettings} appSettingsLoaded onUpdated={vi.fn()} />);

    fireEvent.click(await screen.findByRole("tab", { name: "Accelerators" }));

    const matrices = await screen.findAllByRole("table");
    expect(matrices).toHaveLength(3);
    const memberPill = document.querySelector(".transcode-federation-member-pill:not(.transcode-federation-local-pill)");
    expect(memberPill).not.toBeNull();
    expect(memberPill).toHaveTextContent("Federick-PC");
    expect(memberPill).not.toHaveClass("transcode-federation-local-pill");
    expect(memberPill?.closest("details.transcode-device-matrix")).not.toBeNull();
    const localPills = document.querySelectorAll(".transcode-federation-local-pill");
    expect(localPills).toHaveLength(2);
    for (const localPill of localPills) {
      expect(localPill).toHaveClass("badge", "transcode-federation-member-pill");
      expect(localPill).toHaveTextContent("local");
    }
    const deviceEntries = document.querySelectorAll("details.transcode-device-matrix");
    expect(deviceEntries[0].querySelector(".transcode-capability-device-icon-gpu")).not.toBeNull();
    expect(deviceEntries[1].querySelector(".transcode-capability-device-icon-cpu")).not.toBeNull();
    expect(deviceEntries[2].querySelector(".transcode-capability-device-icon-gpu")).not.toBeNull();
    expect(screen.queryByText(/Hardware capability matrix/)).not.toBeInTheDocument();
  });

  it("shows federation members in the shared automation toggle", async () => {
    vi.mocked(api.transcodeFederation).mockResolvedValueOnce(federationWithMember);
    render(<TranscodingSettingsPanel settings={appSettings} appSettingsLoaded onUpdated={vi.fn()} />);

    fireEvent.click(await screen.findByRole("tab", { name: "Members" }));

    expect(await screen.findByText("Federick-PC")).toBeInTheDocument();
    expect(screen.queryByRole("searchbox", { name: "Search federation members" })).not.toBeInTheDocument();
    const memberList = document.querySelector(".compatibility-profile-list");
    expect(memberList?.querySelector('[role="tablist"]')).not.toBeNull();
    expect(memberList?.querySelector(".transcode-automation-toggle-row")).not.toBeNull();
    expect(screen.getByText("16 CPU · 125 GB free · 0 active jobs · v0.18.0-dev042")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sync Federick-PC" })).toHaveClass("compatibility-profile-quick-action");
    expect(screen.getByRole("button", { name: "Disconnect Federick-PC" })).toHaveClass("compatibility-profile-quick-action");
    expect(document.querySelector(".transcode-federation-members")).toBeNull();

    fireEvent.click(screen.getByText("Federick-PC"));
    const acceleratorLink = await screen.findByRole("link", { name: /NVIDIA GeForce RTX 3080/ });
    expect(screen.queryByDisplayValue("http://federick-pc:8091")).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue("connected")).not.toBeInTheDocument();
    expect(acceleratorLink).toHaveAttribute(
      "href",
      `#${buildTranscodingMatrixAnchorId("member-installation", "cuda0")}`,
    );
    expect(document.querySelector(".transcode-federation-member-tab-details .app-settings-flag-toggle")).toBeNull();
    fireEvent.click(acceleratorLink);
    expect(screen.getByRole("tab", { name: "Accelerators" })).toHaveAttribute("aria-selected", "true");
    expect(document.getElementById(buildTranscodingMatrixAnchorId("member-installation", "cuda0"))).toHaveAttribute("open");
  });

  it("maps raw member accelerator ids to grouped capability matrix entries", async () => {
    vi.mocked(api.transcodeFederation).mockResolvedValueOnce(federationWithMemberCapabilities);
    render(<TranscodingSettingsPanel settings={appSettings} appSettingsLoaded onUpdated={vi.fn()} />);

    fireEvent.click(await screen.findByRole("tab", { name: "Members" }));
    fireEvent.click(await screen.findByText("Federick-PC"));

    const acceleratorLink = await screen.findByRole("link", { name: /NVIDIA GeForce RTX 3080/ });
    const matrixAnchor = buildTranscodingMatrixAnchorId("member-installation", "device:cuda0");
    expect(acceleratorLink).toHaveAttribute("href", `#${matrixAnchor}`);

    fireEvent.click(acceleratorLink);
    expect(document.getElementById(matrixAnchor)).toHaveAttribute("open");
  });
});
