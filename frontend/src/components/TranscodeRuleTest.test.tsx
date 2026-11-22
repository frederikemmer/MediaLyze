import "../i18n";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { api } from "../lib/api";
import { TranscodeRuleTest } from "./TranscodeRuleTest";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("searches for a file and renders the server trace before the output without saving", async () => {
  const search = vi.spyOn(api, "searchTranscodeRuleAssets").mockResolvedValue([
    { id: 72, library_id: 3, title: "An episode", filename: "S01E01.mkv" },
  ]);
  const preview = vi.spyOn(api, "testTranscodeRule").mockResolvedValue({
    in_scope: true, status: "matched", reason: null, output_path: "/out/Series/S01E01.mkv",
    output_relative_path: "Series/S01E01.mkv",
    trace: { matched: true, values: [], children: [
      { matched: true, values: ["en"], children: [] }, { matched: false, values: ["en"], children: [] },
    ] },
  });
  render(<TranscodeRuleTest presetName="HEVC" draft={{
    library_ids: [3], profile_id: 1, output_mode: "transcode_output", output_subfolder: "",
    conditions: { type: "group", operator: "xor", children: [
      { type: "condition", field: "audio_languages", operator: "equals", value: "en" },
      { type: "condition", field: "audio_languages", operator: "equals", value: "de" },
    ] },
  }} />);
  const input = screen.getByRole("textbox", { name: "Find file" });
  fireEvent.change(input, { target: { value: "S01" } });
  const choice = await screen.findByRole("button", { name: /An episode · S01E01\.mkv/ });
  expect(search).toHaveBeenCalledWith("S01", expect.any(AbortSignal));
  fireEvent.keyDown(input, { key: "ArrowDown" });
  expect(choice).toHaveFocus();
  fireEvent.click(choice);
  const path = await screen.findByText("Transcode_Output/Series/S01E01.mkv");
  expect(preview).toHaveBeenCalledWith(expect.objectContaining({ file_id: 72, conditions: expect.objectContaining({ operator: "xor" }) }), expect.any(AbortSignal));
  expect(screen.queryByRole("button", { name: /An episode · S01E01\.mkv/ })).toBeNull();
  const trace = screen.getByText(/Exactly one matches/).closest("li")!;
  expect(trace).toHaveClass("is-match");
  expect(within(trace).getByText("Does not match")).toBeInTheDocument();
  expect(trace.compareDocumentPosition(path) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(path).toHaveClass("jellyfin-status-badge");
});
