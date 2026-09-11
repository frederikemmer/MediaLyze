import "../i18n";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  api,
  type TranscodeFederation,
  type TranscodeProfile,
  type TranscodeProfileDefinition,
} from "../lib/api";
import { TranscodeProfilesRulesPanel } from "./TranscodeProfilesRulesPanel";

const definition: TranscodeProfileDefinition = {
  version: 1,
  container: "source",
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
  filename_template_override: false,
  include_subtitle_languages: false,
  execution_mode: "inherit",
};

function profile(overrides: Partial<TranscodeProfile> = {}): TranscodeProfile {
  return {
    id: 1,
    name: "Compatibility",
    description: "Copy compatible streams.",
    version: 1,
    is_builtin: true,
    builtin_key: "compatibility",
    definition,
    used_by_rule_count: 0,
    created_at: "2026-09-07T09:00:00Z",
    updated_at: "2026-09-07T09:00:00Z",
    ...overrides,
  };
}

const federationFixture: TranscodeFederation = {
  settings: {
    enabled: true,
    federation_id: "federation-1",
    installation_id: "local",
    federation_name: "",
    display_name: "Local installation",
    pairing_code: "123456",
    pairing_code_from_environment: false,
    pairing_code_expires_at: 0,
    discovery_enabled: true,
    accept_jobs: true,
    endpoint_urls: ["http://local:8091"],
    hostname_urls: [],
    ip_urls: [],
    resource_policy: {},
    protocol_version: 1,
    temp_budget_bytes: 0,
    result_retention_hours: 24,
  },
  members: [{
    id: 1,
    installation_id: "worker-02",
    federation_id: "federation-1",
    display_name: "Worker 02",
    endpoint_urls: ["http://worker-02:8091"],
    protocol_version: 1,
    application_version: "0.18.0",
    status: "active",
    connection_status: "connected",
    reachable: true,
    accept_jobs: true,
    resources: { cpu_threads: 16, temp_free_bytes: 420 * 1024 * 1024 * 1024 },
    capabilities: null,
    capability_matrix: null,
    active_jobs: 0,
    network_mbps: 1000,
    last_seen_at: null,
    last_sync_at: null,
    last_error: null,
  }],
  discovered: [{
    installation_id: "worker-01",
    federation_id: "federation-1",
    display_name: "Worker 01",
    endpoint_urls: ["http://worker-01:8091"],
    protocol_version: 1,
    application_version: "0.18.0",
    reachable: true,
    last_seen_at: null,
  }],
};

describe("TranscodeProfilesRulesPanel", () => {
  const builtin = profile();
  const custom = profile({
    id: 2,
    name: "My profile",
    description: "My custom stream plan.",
    is_builtin: false,
    builtin_key: null,
  });
  const copy = profile({
    id: 3,
    name: "Compatibility copy",
    description: "Copy compatible streams.",
    is_builtin: false,
    builtin_key: null,
  });

  beforeEach(() => {
    vi.spyOn(api, "transcodeProfiles").mockResolvedValue([builtin, custom]);
    vi.spyOn(api, "transcodeRules").mockResolvedValue([]);
    vi.spyOn(api, "libraries").mockResolvedValue([]);
    vi.spyOn(api, "duplicateTranscodeProfile").mockResolvedValue(copy);
    vi.spyOn(api, "deleteTranscodeProfile").mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("exposes editable custom profiles and makes built-in templates customizable without deleting them", async () => {
    const { container } = render(
      <TranscodeProfilesRulesPanel
        capabilityMatrix={(tabControls) => (
          <section className="transcode-automation-tab-content" data-testid="capability-matrix">
            <div className="compatibility-profile-list">{tabControls}</div>
          </section>
        )}
        acceleratorsTooltip={<div data-testid="accelerators-tooltip" />}
      />,
    );

    const tabList = await screen.findByRole("tablist", { name: "Transcoding profiles and rules" });
    expect(tabList).toHaveClass("transcode-automation-tab-list");
    expect(tabList.querySelector(".library-history-range-pill")).toBeNull();
    expect(screen.getByRole("tab", { name: "Accelerators" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Profiles" })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("tab", { name: "Accelerators" }));
    expect(screen.getByRole("button", { name: "Explain accelerators" })).toBeInTheDocument();
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Accelerators" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Profiles" })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByTestId("capability-matrix")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Profiles" }));
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Profiles" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("button", { name: "Reload" })).not.toBeInTheDocument();
    expect(screen.queryByText("Reusable stream plans and automatic matching rules.")).not.toBeInTheDocument();
    const descriptionTooltip = screen.getByRole("button", { name: "Explain transcoding profiles" });
    expect(descriptionTooltip).toHaveClass("tooltip-trigger");
    fireEvent.click(descriptionTooltip);
    const descriptionPortal = await screen.findByRole("tooltip");
    expect(descriptionPortal).toHaveClass("transcode-automation-description-tooltip-portal-compact");
    expect(descriptionPortal).toHaveStyle({ maxWidth: "300px" });
    fireEvent.pointerDown(document.body);
    expect((await screen.findByRole("button", { name: "New profile" })).closest(".settings-profile-toggle-row")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Compatibility" })).toBeInTheDocument();
    expect(screen.queryByText("v1 · built-in")).not.toBeInTheDocument();

    const customizeButton = await screen.findByRole("button", { name: "Customize Compatibility" });
    expect(customizeButton).toHaveClass("compatibility-profile-quick-action");

    const editButton = screen.getByRole("button", { name: "Edit My profile" });
    expect(editButton).toHaveClass("compatibility-profile-quick-action");

    const builtinDeleteButton = screen.getByRole("button", { name: "Delete Compatibility" });
    expect(builtinDeleteButton).toBeDisabled();
    expect(builtinDeleteButton).toHaveAttribute("title", "Built-in templates cannot be deleted; create a copy to customize one.");

    fireEvent.click(editButton);
    expect(await screen.findByDisplayValue("My profile")).toBeInTheDocument();
    expect(screen.getByDisplayValue("My custom stream plan.").tagName).toBe("TEXTAREA");
    expect(container.querySelector("details.compatibility-capability-section")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    fireEvent.click(customizeButton);
    await waitFor(() => expect(api.duplicateTranscodeProfile).toHaveBeenCalledWith(builtin.id));
    expect(await screen.findByText("Edit profile")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Delete My profile" }));
    await waitFor(() => expect(api.deleteTranscodeProfile).toHaveBeenCalledWith(custom.id));

    fireEvent.click(screen.getByRole("tab", { name: "Rules" }));
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Rules" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("button", { name: "Explain transcoding rules" })).toBeInTheDocument();
    expect(screen.queryByText("Rules are evaluated from top to bottom. A blocked winning rule does not fall through.")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reload" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Preview" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start inventory" })).not.toBeInTheDocument();
  });

  it("lists paired members before discovered peers and marks new pairing entries with plus icons", async () => {
    const { container } = render(
      <TranscodeProfilesRulesPanel
        capabilityMatrix={(tabControls) => <section className="transcode-automation-tab-content">{tabControls}</section>}
        acceleratorsTooltip={<div data-testid="accelerators-tooltip" />}
        federation={federationFixture}
      />,
    );

    await screen.findByRole("tablist", { name: "Transcoding profiles and rules" });
    fireEvent.click(screen.getByRole("tab", { name: "Members" }));

    const memberArticle = screen.getByText("Worker 02").closest("article");
    const discoveredArticle = screen.getByText("Worker 01").closest("article");
    expect(memberArticle).not.toBeNull();
    expect(discoveredArticle).not.toBeNull();
    expect(memberArticle!.compareDocumentPosition(discoveredArticle!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(memberArticle!.querySelector(".transcode-federation-entry-marker.transcode-federation-status-marker")).not.toBeNull();
    expect(memberArticle!.querySelector(".transcode-federation-member-row")).not.toBeNull();
    expect(memberArticle!.querySelector(".transcode-federation-member-trigger")).toHaveClass("compatibility-profile-list-trigger");
    expect(memberArticle!.querySelector(".status-dot")).toHaveClass("is-online");
    expect(memberArticle!.querySelector(".transcode-federation-status-trigger")).toHaveAttribute("aria-label", "Worker 02: Reachable");
    expect(memberArticle!.querySelector(".transcode-federation-add-icon")).toBeNull();
    expect(discoveredArticle!.querySelector(".transcode-federation-entry-marker.transcode-federation-add-icon")).not.toBeNull();
    expect(discoveredArticle!.querySelector(".transcode-federation-peer-code-input")).toHaveAttribute("placeholder", "Pairing code");

    expect(screen.queryByText("Add trusted installation")).not.toBeInTheDocument();
    const manualItem = container.querySelector(".transcode-federation-manual-item");
    const manualConnectControl = manualItem?.querySelector(".transcode-federation-peer-connect-control");
    expect(manualConnectControl).not.toBeNull();
    expect(manualConnectControl).toHaveClass("transcode-federation-manual-connect-control");
    expect(manualConnectControl?.parentElement).toBe(manualItem);
    expect(manualItem?.querySelector(":scope > .transcode-federation-add-icon")).not.toBeNull();
    expect(manualItem?.querySelector(":scope > .transcode-federation-add-icon")?.parentElement).toBe(manualItem);
    expect(manualConnectControl?.querySelector(":scope > .transcode-federation-add-icon")).toBeNull();
    expect(manualConnectControl?.querySelector(':scope > input[type="url"]')).toHaveClass("transcode-federation-segment-input", "transcode-federation-manual-address-input");
    expect(manualConnectControl?.querySelector(".transcode-federation-manual-code-input")).not.toBeNull();
    expect(manualConnectControl?.querySelector(".transcode-federation-manual-code-input")).toHaveAttribute("placeholder", "Pairing code");
    expect(manualConnectControl?.querySelector(".transcode-federation-connect-button")).not.toBeNull();
    expect(manualConnectControl?.querySelector(".transcode-federation-manual-code-input")?.nextElementSibling).toBe(
      manualConnectControl?.querySelector(".transcode-federation-connect-button"),
    );
  });

  it("confirms disconnect and refreshes the installation as a discovered peer", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const disconnectedPeer = {
      installation_id: federationFixture.members[0].installation_id,
      federation_id: federationFixture.members[0].federation_id,
      display_name: federationFixture.members[0].display_name,
      endpoint_urls: federationFixture.members[0].endpoint_urls,
      protocol_version: federationFixture.members[0].protocol_version,
      application_version: federationFixture.members[0].application_version,
      reachable: true,
      last_seen_at: null,
    };
    const refreshedFederation: TranscodeFederation = {
      ...federationFixture,
      members: [],
      discovered: [disconnectedPeer],
    };
    vi.spyOn(api, "excludeTranscodeFederationMember").mockResolvedValue(undefined);
    vi.spyOn(api, "discoverTranscodeFederation").mockResolvedValue(refreshedFederation);
    const onFederationData = vi.fn();
    const { rerender } = render(
      <TranscodeProfilesRulesPanel
        capabilityMatrix={(tabControls) => <section className="transcode-automation-tab-content">{tabControls}</section>}
        acceleratorsTooltip={<div data-testid="accelerators-tooltip" />}
        federation={federationFixture}
        onFederationData={onFederationData}
      />,
    );

    await screen.findByRole("tablist", { name: "Transcoding profiles and rules" });
    fireEvent.click(screen.getByRole("tab", { name: "Members" }));
    fireEvent.click(screen.getByRole("button", { name: "Disconnect Worker 02" }));

    await waitFor(() => expect(api.excludeTranscodeFederationMember).toHaveBeenCalledWith("worker-02"));
    await waitFor(() => expect(api.discoverTranscodeFederation).toHaveBeenCalledTimes(1));
    expect(confirm).toHaveBeenCalledWith("Disconnect Worker 02? It will no longer receive automatic jobs.");
    expect(await screen.findByRole("status")).toHaveTextContent("Worker 02 disconnected.");
    expect(onFederationData).toHaveBeenCalledWith(expect.objectContaining({ members: [] }));
    expect(onFederationData).toHaveBeenLastCalledWith(refreshedFederation);

    rerender(
      <TranscodeProfilesRulesPanel
        capabilityMatrix={(tabControls) => <section className="transcode-automation-tab-content">{tabControls}</section>}
        acceleratorsTooltip={<div data-testid="accelerators-tooltip" />}
        federation={refreshedFederation}
        onFederationData={onFederationData}
      />,
    );
    const discoveredArticle = screen.getByText("Worker 02").closest("article");
    expect(discoveredArticle?.querySelector(".transcode-federation-add-icon")).not.toBeNull();
    expect(discoveredArticle?.querySelector(".transcode-federation-peer-code-input")).not.toBeNull();
  });

  it("uses the member status dot for warning details instead of an inline alert", async () => {
    const member = {
      ...federationFixture.members[0],
      last_error: "timed out",
      connection_status: "connected",
    };
    const { container } = render(
      <TranscodeProfilesRulesPanel
        capabilityMatrix={(tabControls) => <section className="transcode-automation-tab-content">{tabControls}</section>}
        acceleratorsTooltip={<div data-testid="accelerators-tooltip" />}
        federation={{ ...federationFixture, members: [member], discovered: [] }}
      />,
    );

    await screen.findByRole("tablist", { name: "Transcoding profiles and rules" });
    fireEvent.click(screen.getByRole("tab", { name: "Members" }));

    const memberArticle = container.querySelector(".compatibility-profile-list-item");
    const statusTrigger = memberArticle?.querySelector<HTMLButtonElement>(".transcode-federation-status-trigger");
    expect(statusTrigger).not.toBeNull();
    expect(statusTrigger?.querySelector(".status-dot")).toHaveClass("is-warning");

    fireEvent.focus(statusTrigger!);
    expect(await screen.findByText("Last error")).toBeInTheDocument();
    expect(screen.getByText("timed out")).toBeInTheDocument();

    fireEvent.click(memberArticle!.querySelector<HTMLButtonElement>(".compatibility-profile-list-trigger")!);
    expect(memberArticle?.querySelector(".notice.error")).toBeNull();
  });

  it("marks unreachable members as offline", async () => {
    const member = {
      ...federationFixture.members[0],
      reachable: false,
      connection_status: "offline",
      last_error: "Connection refused",
    };
    const { container } = render(
      <TranscodeProfilesRulesPanel
        capabilityMatrix={(tabControls) => <section className="transcode-automation-tab-content">{tabControls}</section>}
        acceleratorsTooltip={<div data-testid="accelerators-tooltip" />}
        federation={{ ...federationFixture, members: [member], discovered: [] }}
      />,
    );

    await screen.findByRole("tablist", { name: "Transcoding profiles and rules" });
    fireEvent.click(screen.getByRole("tab", { name: "Members" }));

    const statusDot = container.querySelector(".transcode-federation-status-trigger .status-dot");
    expect(statusDot).toHaveClass("is-offline");
  });
});
