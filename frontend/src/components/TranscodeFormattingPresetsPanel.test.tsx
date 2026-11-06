vi.mock("../lib/notifications", () => ({ useNotifications: () => ({ notify: vi.fn() }), useOptionalNotifications: () => ({ notify: vi.fn() }) }));
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

    render(<TranscodeFormattingPresetsPanel kind="filename" tabs={<span>Filename Presets</span>} />);
    fireEvent.click(screen.getByRole("button", { name: "New preset" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Preset name" }), { target: { value: "My name" } });
    const template = screen.getByRole("textbox", { name: "Filename formatting" });
    expect(template).toHaveAttribute("contenteditable", "true");
    expect(template.querySelector('[data-filename-token="sourceName"]')).toHaveClass("is-source-name");
    template.textContent = "[{codec}]";
    fireEvent.input(template);
    expect(template.querySelector('[data-filename-token="codec"]')).toHaveClass("is-medialyze");
    expect(screen.queryByRole("checkbox", { name: "Enable filename formatting" })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "Include subtitle languages" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add metadata" }));
    expect(screen.getByRole("group", { name: /metadata tokens/i })).toHaveTextContent("{subtitleLanguages}");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("button", { name: "Set My name as default" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Set My name as default" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Remove My name as default" })).toHaveAttribute("aria-pressed", "true"));
    expect(api.createTranscodeFormattingPreset).toHaveBeenCalledWith(expect.objectContaining({
      definition: expect.objectContaining({ template: "[{codec}]", enabled: true, include_subtitle_languages: false }),
    }));
  });

  it("offers colored folder tokens, subtitle metadata, and a separate language-code format", async () => {
    vi.spyOn(api, "transcodeFormattingPresets").mockResolvedValue([]);
    vi.spyOn(api, "createTranscodeFormattingPreset").mockImplementation(async (input) => ({ ...input, id: 5, is_default: false }));

    render(<TranscodeFormattingPresetsPanel kind="folder" tabs={<span>Foldername Presets</span>} />);
    fireEvent.click(screen.getByRole("button", { name: "New preset" }));
    const template = screen.getByRole("textbox", { name: "Folder name template" });
    expect(template.querySelector('[data-filename-token="folderName"]')).toHaveClass("is-medialyze");
    fireEvent.click(screen.getByRole("button", { name: "Add metadata" }));
    expect(screen.getByRole("group", { name: /metadata tokens/i })).toHaveTextContent("{subtitleLanguages}");
    template.textContent = "{folderName} [{subtitleLanguages}]";
    fireEvent.input(template);
    fireEvent.change(screen.getByRole("combobox", { name: "Language code format" }), { target: { value: "iso_639_2" } });
    expect(screen.getByText("Movies [eng, ger]")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Preset name" }), { target: { value: "Folder rule" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.createTranscodeFormattingPreset).toHaveBeenCalledWith(expect.objectContaining({
      kind: "folder",
      definition: expect.objectContaining({ enabled: true, language_code_format: "iso_639_2" }),
    })));
  });

  it("starts a fresh folder draft when switching away from a filename draft", async () => {
    vi.spyOn(api, "transcodeFormattingPresets").mockResolvedValue([]);
    const view = render(<TranscodeFormattingPresetsPanel kind="filename" tabs={<span>Filename Presets</span>} />);
    fireEvent.click(screen.getByRole("button", { name: "New preset" }));
    expect(screen.getByRole("textbox", { name: "Filename formatting" })).toBeInTheDocument();
    view.rerender(<TranscodeFormattingPresetsPanel kind="folder" tabs={<span>Foldername Presets</span>} />);
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "Filename formatting" })).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "New preset" }));
    const folderTemplate = screen.getByRole("textbox", { name: "Folder name template" });
    expect(folderTemplate).toHaveAttribute("aria-valuetext", "{folderName}");
  });
});
