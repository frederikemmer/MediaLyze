import "../i18n";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  api,
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
        capabilityMatrix={<div data-testid="capability-matrix" />}
        acceleratorsTooltip={<div data-testid="accelerators-tooltip" />}
      />,
    );

    expect(await screen.findByRole("tablist", { name: "Transcoding profiles and rules" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Accelerators" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Accelerators" }));
    expect(screen.getByRole("button", { name: "Explain accelerators" })).toBeInTheDocument();
    expect(screen.getByTestId("capability-matrix")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Transcoding profiles" }));
    expect(screen.getByRole("searchbox", { name: "Search profiles" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reload" })).not.toBeInTheDocument();
    expect(screen.queryByText("Reusable stream plans and automatic matching rules.")).not.toBeInTheDocument();
    const descriptionTooltip = screen.getByRole("button", { name: "Explain transcoding profiles" });
    expect(descriptionTooltip).toHaveClass("tooltip-trigger");
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

    fireEvent.click(screen.getByRole("button", { name: "Transcoding rules" }));
    expect(screen.getByRole("button", { name: "Explain transcoding rules" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reload" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Preview" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start inventory" })).not.toBeInTheDocument();
  });
});
