import "../i18n";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { api, type TranscodeFormattingPreset } from "../lib/api";
import { TranscodeFormattingPresetsPanel } from "./TranscodeFormattingPresetsPanel";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("TranscodeFormattingPresetsPanel", () => {
  it("creates a filename preset and sets it as the category default", async () => {
    vi.spyOn(api, "transcodeFormattingPresets").mockResolvedValue([]);
    let saved: TranscodeFormattingPreset | null = null;
    vi.spyOn(api, "createTranscodeFormattingPreset").mockImplementation(async (input) => {
      saved = { ...input, id: 4, is_default: false };
      return saved;
    });
    vi.spyOn(api, "updateTranscodeFormattingPreset").mockImplementation(async (_id, changes) => {
      saved = { ...(saved as TranscodeFormattingPreset), ...changes };
      return saved;
    });

    render(<TranscodeFormattingPresetsPanel kind="filename" tabs={<span>Filename presets</span>} />);
    fireEvent.click(screen.getByRole("button", { name: "New preset" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Preset name" }), { target: { value: "My name" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Filename formatting" }), { target: { value: "[{codec}]" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("button", { name: "Set My name as default" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Set My name as default" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Remove My name as default" })).toHaveAttribute("aria-pressed", "true"));
    expect(api.createTranscodeFormattingPreset).toHaveBeenCalledWith(expect.objectContaining({
      definition: expect.objectContaining({ template: "[{codec}]" }),
    }));
  });
});
