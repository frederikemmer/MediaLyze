import i18n from "../i18n";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildProfileIssue, CompatibilityProfilesPanel } from "./CompatibilityProfilesPanel";
import {
  api,
  type CompatibilityProfile,
  type HardwareProfile,
  type SoftwareProfile,
} from "../lib/api";

function profile(notes = "Test"): HardwareProfile {
  return {
    schema_version: 1,
    profile_version: 1,
    id: "test-device",
    name: "Test Device",
    category: "streaming_device",
    manufacturer: "Test",
    status: "local",
    added: "2026-06-10",
    last_modified: "2026-06-10",
    notes,
    sources: [],
    video: {},
    audio: {},
    containers: [],
    subtitles: {},
  };
}

function softwareProfile(): SoftwareProfile {
  return {
    schema_version: 1,
    profile_version: 1,
    id: "test-player",
    name: "Test Player",
    category: "player",
    developer: "Test",
    platforms: ["desktop"],
    status: "local",
    added: "2026-06-10",
    last_modified: "2026-06-10",
    sources: [],
    video: {},
    audio: {},
    containers: {},
    subtitles: {},
  };
}

function combinationProfile(): CompatibilityProfile {
  return {
    schema_version: 1,
    profile_version: 1,
    id: "test-combination",
    name: "Test Combination",
    hardware_profile_id: "test-device",
    software_profile_id: "test-player",
    status: "local",
    added: "2026-06-10",
    last_modified: "2026-06-10",
    sources: [],
  };
}

describe("buildProfileIssue", () => {
  it("prefills new profile issues without requiring GitHub authentication", () => {
    const issue = buildProfileIssue(profile(), "Manufacturer documentation");
    const url = new URL(issue.url);

    expect(url.origin).toBe("https://github.com");
    expect(url.searchParams.get("labels")).toBe("new feature");
    expect(url.searchParams.get("body")).toContain("Manufacturer documentation");
    expect(url.searchParams.get("body")).toContain('"id": "test-device"');
    expect(issue.overflowBody).toBeNull();
  });

  it("uses enhancement issues for local overrides", () => {
    const changed = {
      ...profile(),
      base_profile_id: "official-device",
      base_profile_version: 3,
    };
    const url = new URL(buildProfileIssue(changed, "Corrected codec support").url);
    expect(url.searchParams.get("labels")).toBe("enhancement");
    expect(url.searchParams.get("body")).toContain("official-device");
  });

  it("falls back to clipboard content for oversized issue bodies", () => {
    const issue = buildProfileIssue(profile("x".repeat(9000)), "Reason");
    expect(issue.overflowBody).toContain("Profile JSON");
    expect(issue.url.length).toBeLessThan(7000);
  });
});

describe("CompatibilityProfilesPanel", () => {
  beforeEach(() => {
    void i18n.changeLanguage("en");
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders profiles as compact collapsed rows and expands details on demand", async () => {
    vi.spyOn(api, "hardwareProfiles").mockResolvedValue([
      { ...profile(), catalog_source: "official", status: "official", manufacturer: "Test" },
    ]);
    vi.spyOn(api, "softwareProfiles").mockResolvedValue([]);
    vi.spyOn(api, "compatibilityProfiles").mockResolvedValue([]);

    render(<CompatibilityProfilesPanel />);

    expect(await screen.findByRole("button", { name: "Combination" })).toBeInTheDocument();
    const trigger = await screen.findByRole("button", { name: "Test Device" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByLabelText("Manufacturer")).not.toBeInTheDocument();

    fireEvent.click(trigger);

    expect(await screen.findByLabelText("Manufacturer")).toHaveValue("Test");
    expect(screen.getByLabelText("Manufacturer")).toHaveAttribute("readonly");
    expect(trigger).toHaveAttribute("aria-expanded", "true");
  });

  it("favorites hardware, software, and combination profiles with local persistence", async () => {
    vi.spyOn(api, "hardwareProfiles").mockResolvedValue([profile()]);
    vi.spyOn(api, "softwareProfiles").mockResolvedValue([softwareProfile()]);
    vi.spyOn(api, "compatibilityProfiles").mockResolvedValue([combinationProfile()]);

    render(<CompatibilityProfilesPanel />);

    const hardwareFavorite = await screen.findByRole("button", {
      name: "Add Test Device to favorites",
    });
    fireEvent.click(hardwareFavorite);
    expect(hardwareFavorite).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: "Software / Player" }));
    const softwareFavorite = await screen.findByRole("button", {
      name: "Add Test Player to favorites",
    });
    fireEvent.click(softwareFavorite);
    expect(softwareFavorite).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: "Combination" }));
    const combinationFavorite = await screen.findByRole("button", {
      name: "Add Test Combination to favorites",
    });
    fireEvent.click(combinationFavorite);
    expect(combinationFavorite).toHaveAttribute("aria-pressed", "true");

    expect(JSON.parse(window.localStorage.getItem("medialyze.compatibility-profile-favorites") ?? "[]"))
      .toEqual(expect.arrayContaining([
        "hardware:test-device",
        "software:test-player",
        "compatibility:test-combination",
      ]));
  });

  it("opens profile details read-only and edits local profiles through the quick action", async () => {
    vi.spyOn(api, "hardwareProfiles").mockResolvedValue([
      { ...profile(), catalog_source: "local", manufacturer: "Test" },
    ]);
    vi.spyOn(api, "softwareProfiles").mockResolvedValue([]);
    vi.spyOn(api, "compatibilityProfiles").mockResolvedValue([]);

    render(<CompatibilityProfilesPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "Test Device" }));

    const manufacturer = await screen.findByLabelText("Manufacturer");
    expect(manufacturer).toHaveAttribute("readonly");

    fireEvent.click(screen.getByRole("button", { name: "Edit profile Test Device" }));

    expect(manufacturer).not.toHaveAttribute("readonly");
    fireEvent.change(manufacturer, { target: { value: "Updated" } });
    await waitFor(() => expect(manufacturer).toHaveValue("Updated"));
  });

  it("uses a hardware-specific category dropdown in edit mode", async () => {
    vi.spyOn(api, "hardwareProfiles").mockResolvedValue([
      { ...profile(), catalog_source: "local", manufacturer: "Test" },
    ]);
    vi.spyOn(api, "softwareProfiles").mockResolvedValue([]);
    vi.spyOn(api, "compatibilityProfiles").mockResolvedValue([]);

    render(<CompatibilityProfilesPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "Test Device" }));

    const category = screen.getByLabelText("Category");
    expect(category).toBeDisabled();
    expect(screen.getByRole("option", { name: "Streaming device" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Smart TV" })).toBeInTheDocument();
    expect(Array.from((category as HTMLSelectElement).options).map((option) => option.value)).toContain("other");
    expect(screen.queryByRole("option", { name: "Media server" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Edit profile Test Device" }));
    expect(category).toBeEnabled();
    fireEvent.change(category, { target: { value: "smart_tv" } });
    expect(category).toHaveValue("smart_tv");
  });

  it("uses a verification dropdown and preserves custom verification text", async () => {
    vi.spyOn(api, "hardwareProfiles").mockResolvedValue([
      { ...profile(), verified_by: "lab certification", catalog_source: "local" },
    ]);
    vi.spyOn(api, "softwareProfiles").mockResolvedValue([]);
    vi.spyOn(api, "compatibilityProfiles").mockResolvedValue([]);

    render(<CompatibilityProfilesPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "Test Device" }));

    const verification = screen.getByLabelText("Verified by");
    expect(verification).toBeDisabled();
    expect(verification).toHaveValue("other");
    expect(screen.getByLabelText("Other verification")).toHaveValue("lab certification");

    fireEvent.click(screen.getByRole("button", { name: "Edit profile Test Device" }));
    expect(verification).toBeEnabled();
    fireEvent.change(verification, { target: { value: "independent testing" } });
    expect(verification).toHaveValue("independent testing");
    expect(screen.queryByLabelText("Other verification")).not.toBeInTheDocument();
  });

  it("shows edit, clone, and disabled delete quick actions for official profiles", async () => {
    vi.spyOn(api, "hardwareProfiles").mockResolvedValue([
      { ...profile(), catalog_source: "official", status: "official", manufacturer: "Test" },
    ]);
    vi.spyOn(api, "softwareProfiles").mockResolvedValue([]);
    vi.spyOn(api, "compatibilityProfiles").mockResolvedValue([]);

    render(<CompatibilityProfilesPanel />);

    expect(await screen.findByRole("button", { name: "Edit profile Test Device" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Clone profile Test Device" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Delete profile Test Device" })).toBeDisabled();
  });

  it("filters profiles by name and id from the search row inside the list", async () => {
    vi.spyOn(api, "hardwareProfiles").mockResolvedValue([
      { ...profile(), id: "test-device", name: "Test Device", catalog_source: "local" },
      { ...profile(), id: "living-room-player", name: "Living Room Player", catalog_source: "local" },
    ]);
    vi.spyOn(api, "softwareProfiles").mockResolvedValue([]);
    vi.spyOn(api, "compatibilityProfiles").mockResolvedValue([]);

    render(<CompatibilityProfilesPanel />);

    const search = await screen.findByRole("searchbox", { name: "Search Hardware profiles" });
    fireEvent.change(search, { target: { value: "living-room" } });

    expect(screen.queryByRole("button", { name: "Test Device" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Living Room Player" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Clear profile search" }));
    expect(screen.getByRole("button", { name: "Test Device" })).toBeInTheDocument();
  });

  it("edits official profiles as local copies and keeps the GitHub proposal action in the details", async () => {
    vi.spyOn(api, "hardwareProfiles")
      .mockResolvedValueOnce([
        { ...profile(), catalog_source: "official", status: "official", manufacturer: "Test" },
      ])
      .mockResolvedValue([]);
    vi.spyOn(api, "softwareProfiles").mockResolvedValue([]);
    vi.spyOn(api, "compatibilityProfiles").mockResolvedValue([]);
    const createProfile = vi.spyOn(api, "createHardwareProfile").mockResolvedValue(profile());

    render(<CompatibilityProfilesPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit profile Test Device" }));

    expect(await screen.findByLabelText("Manufacturer")).not.toHaveAttribute("readonly");
    expect(screen.queryByLabelText("ID")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Propose on GitHub" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save local copy" }));

    await waitFor(() => expect(createProfile).toHaveBeenCalledWith(expect.objectContaining({
      id: "test-device-local",
      base_profile_id: "test-device",
      base_profile_version: 1,
      status: "local",
    })));
  });

  it("generates new profile ids from the name without exposing an id field", async () => {
    vi.spyOn(api, "hardwareProfiles").mockResolvedValue([]);
    vi.spyOn(api, "softwareProfiles").mockResolvedValue([]);
    vi.spyOn(api, "compatibilityProfiles").mockResolvedValue([]);
    const createProfile = vi.spyOn(api, "createHardwareProfile").mockResolvedValue(profile());

    render(<CompatibilityProfilesPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "Add local profile" }));

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Living Room Device" } });
    expect(screen.queryByLabelText("ID")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(createProfile).toHaveBeenCalledWith(expect.objectContaining({
      id: "living-room-device",
      name: "Living Room Device",
    })));
  });

  it("increments local profile versions automatically without showing the version field", async () => {
    vi.spyOn(api, "hardwareProfiles").mockResolvedValue([
      { ...profile(), profile_version: 4, catalog_source: "local" },
    ]);
    vi.spyOn(api, "softwareProfiles").mockResolvedValue([]);
    vi.spyOn(api, "compatibilityProfiles").mockResolvedValue([]);
    const updateProfile = vi.spyOn(api, "updateHardwareProfile").mockResolvedValue(profile());

    render(<CompatibilityProfilesPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit profile Test Device" }));

    expect(screen.queryByLabelText("Profile version")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(updateProfile).toHaveBeenCalledWith(
      "test-device",
      expect.objectContaining({ profile_version: 5 }),
    ));
  });

  it("edits sources as label and URL rows", async () => {
    vi.spyOn(api, "hardwareProfiles").mockResolvedValue([
      {
        ...profile(),
        catalog_source: "local",
        sources: [{ label: "Old source", url: "https://example.com/old" }],
      },
    ]);
    vi.spyOn(api, "softwareProfiles").mockResolvedValue([]);
    vi.spyOn(api, "compatibilityProfiles").mockResolvedValue([]);
    const updateProfile = vi.spyOn(api, "updateHardwareProfile").mockResolvedValue(profile());

    render(<CompatibilityProfilesPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit profile Test Device" }));
    fireEvent.click(screen.getByText("Sources"));

    fireEvent.change(screen.getByLabelText("Label"), { target: { value: "Updated source" } });
    fireEvent.change(screen.getByLabelText("URL"), { target: { value: "https://example.com/new" } });
    fireEvent.click(screen.getByRole("button", { name: "Add source" }));

    expect(screen.getAllByLabelText("Label")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Remove source 2" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(updateProfile).toHaveBeenCalledWith(
      "test-device",
      expect.objectContaining({
        sources: [{ label: "Updated source", url: "https://example.com/new" }],
      }),
    ));
  });

  it("opens source URLs in a new browser tab from read-only profiles", async () => {
    vi.spyOn(api, "hardwareProfiles").mockResolvedValue([
      {
        ...profile(),
        catalog_source: "official",
        status: "official",
        sources: [{ label: "Technical specifications", url: "https://example.com/specifications" }],
      },
    ]);
    vi.spyOn(api, "softwareProfiles").mockResolvedValue([]);
    vi.spyOn(api, "compatibilityProfiles").mockResolvedValue([]);
    const open = vi.spyOn(window, "open").mockImplementation(() => null);

    render(<CompatibilityProfilesPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "Test Device" }));
    fireEvent.click(screen.getByText("Sources"));
    fireEvent.click(screen.getByRole("button", {
      name: "Open source Technical specifications in a new tab",
    }));

    expect(open).toHaveBeenCalledWith(
      "https://example.com/specifications",
      "_blank",
      "noopener,noreferrer",
    );
  });

  it("updates hardware support through a dropdown", async () => {
    vi.spyOn(api, "hardwareProfiles").mockResolvedValue([
      { ...profile(), catalog_source: "local", audio: { aac: true } },
    ]);
    vi.spyOn(api, "softwareProfiles").mockResolvedValue([]);
    vi.spyOn(api, "compatibilityProfiles").mockResolvedValue([]);
    const updateProfile = vi.spyOn(api, "updateHardwareProfile").mockResolvedValue(profile());

    render(<CompatibilityProfilesPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit profile Test Device" }));
    fireEvent.click(screen.getByText("Audio capabilities"));
    fireEvent.change(screen.getByLabelText("Support"), { target: { value: "limited" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(updateProfile).toHaveBeenCalledWith(
      "test-device",
      expect.objectContaining({ audio: { aac: "limited" } }),
    ));
  });

  it("preserves video capability fields that are not exposed by the structured editor", async () => {
    vi.spyOn(api, "hardwareProfiles").mockResolvedValue([
      {
        ...profile(),
        catalog_source: "local",
        video: {
          h264: {
            hardware_decode: true,
            max_width: 4096,
            max_height: 2160,
            max_fps: 30,
          },
        },
      },
    ]);
    vi.spyOn(api, "softwareProfiles").mockResolvedValue([]);
    vi.spyOn(api, "compatibilityProfiles").mockResolvedValue([]);
    const updateProfile = vi.spyOn(api, "updateHardwareProfile").mockResolvedValue(profile());

    render(<CompatibilityProfilesPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit profile Test Device" }));
    fireEvent.click(screen.getByText("Video capabilities"));
    fireEvent.change(screen.getByLabelText("Max. FPS"), { target: { value: "60" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(updateProfile).toHaveBeenCalledWith(
      "test-device",
      expect.objectContaining({
        video: {
          h264: expect.objectContaining({
            hardware_decode: true,
            max_width: 4096,
            max_height: 2160,
            max_fps: 60,
          }),
        },
      }),
    ));
  });

  it("labels empty capability examples as localized placeholders", async () => {
    await i18n.changeLanguage("de");
    vi.spyOn(api, "hardwareProfiles").mockResolvedValue([
      {
        ...profile(),
        catalog_source: "local",
        video: { av1: { hardware_decode: false } },
      },
    ]);
    vi.spyOn(api, "softwareProfiles").mockResolvedValue([]);
    vi.spyOn(api, "compatibilityProfiles").mockResolvedValue([]);

    render(<CompatibilityProfilesPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "Profil Test Device bearbeiten" }));
    fireEvent.click(screen.getByText("Video-Fähigkeiten"));

    expect(screen.getByPlaceholderText("z. B. 4K")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("z. B. 60")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("z. B. 8, 10")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("z. B. HDR10, Dolby Vision")).toBeInTheDocument();
  });

  it("offers common ffprobe video codecs and stores the selected codec id", async () => {
    vi.spyOn(api, "hardwareProfiles").mockResolvedValue([
      {
        ...profile(),
        catalog_source: "local",
        video: { h264: { hardware_decode: true } },
      },
    ]);
    vi.spyOn(api, "softwareProfiles").mockResolvedValue([]);
    vi.spyOn(api, "compatibilityProfiles").mockResolvedValue([]);
    const updateProfile = vi.spyOn(api, "updateHardwareProfile").mockResolvedValue(profile());

    render(<CompatibilityProfilesPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit profile Test Device" }));
    fireEvent.click(screen.getByText("Video capabilities"));

    const codec = screen.getByLabelText("Codec");
    expect(codec).toHaveValue("h264");
    expect(screen.getByRole("option", { name: "H.265 / HEVC (hevc)" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "H.266 / VVC (vvc)" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Apple ProRes (prores)" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Avid DNxHD / DNxHR (dnxhd)" })).toBeInTheDocument();

    fireEvent.change(codec, { target: { value: "vvc" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(updateProfile).toHaveBeenCalledWith(
      "test-device",
      expect.objectContaining({
        video: { vvc: expect.objectContaining({ hardware_decode: true }) },
      }),
    ));
  });

  it("edits hardware decoding as a boolean checkbox", async () => {
    vi.spyOn(api, "hardwareProfiles").mockResolvedValue([
      {
        ...profile(),
        catalog_source: "local",
        video: { av1: { hardware_decode: false } },
      },
    ]);
    vi.spyOn(api, "softwareProfiles").mockResolvedValue([]);
    vi.spyOn(api, "compatibilityProfiles").mockResolvedValue([]);
    const updateProfile = vi.spyOn(api, "updateHardwareProfile").mockResolvedValue(profile());

    render(<CompatibilityProfilesPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit profile Test Device" }));
    fireEvent.click(screen.getByText("Video capabilities"));

    const hardwareDecode = screen.getByRole("checkbox", { name: "Hardware decode" });
    expect(hardwareDecode).not.toBeChecked();
    fireEvent.click(hardwareDecode);
    expect(hardwareDecode).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(updateProfile).toHaveBeenCalledWith(
      "test-device",
      expect.objectContaining({
        video: { av1: expect.objectContaining({ hardware_decode: true }) },
      }),
    ));
  });

  it("offers common media containers and stores the selected container id", async () => {
    vi.spyOn(api, "hardwareProfiles").mockResolvedValue([
      {
        ...profile(),
        catalog_source: "local",
        containers: ["mp4"],
      },
    ]);
    vi.spyOn(api, "softwareProfiles").mockResolvedValue([]);
    vi.spyOn(api, "compatibilityProfiles").mockResolvedValue([]);
    const updateProfile = vi.spyOn(api, "updateHardwareProfile").mockResolvedValue(profile());

    render(<CompatibilityProfilesPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit profile Test Device" }));
    fireEvent.click(screen.getByText("Container support"));

    const container = screen.getByLabelText("Container");
    expect(container).toHaveValue("mp4");
    expect(screen.getByRole("option", { name: "Matroska Video (mkv)" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Blu-ray MPEG-2 Transport Stream (m2ts)" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Material Exchange Format (mxf)" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Windows Recorded TV (wtv)" })).toBeInTheDocument();

    fireEvent.change(container, { target: { value: "webm" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(updateProfile).toHaveBeenCalledWith(
      "test-device",
      expect.objectContaining({ containers: ["webm"] }),
    ));
  });

  it("offers common ffprobe audio codecs and stores the selected codec id", async () => {
    vi.spyOn(api, "hardwareProfiles").mockResolvedValue([
      {
        ...profile(),
        catalog_source: "local",
        audio: { aac: true },
      },
    ]);
    vi.spyOn(api, "softwareProfiles").mockResolvedValue([]);
    vi.spyOn(api, "compatibilityProfiles").mockResolvedValue([]);
    const updateProfile = vi.spyOn(api, "updateHardwareProfile").mockResolvedValue(profile());

    render(<CompatibilityProfilesPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit profile Test Device" }));
    fireEvent.click(screen.getByText("Audio capabilities"));

    const audioCodec = screen.getByLabelText("Format");
    expect(audioCodec).toHaveValue("aac");
    expect(screen.getByRole("option", { name: "Dolby TrueHD (truehd)" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "DTS-HD (dts_hd)" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Blu-ray LPCM (pcm_bluray)" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "MPEG-H 3D Audio (mpegh_3d_audio)" })).toBeInTheDocument();

    fireEvent.change(audioCodec, { target: { value: "flac" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(updateProfile).toHaveBeenCalledWith(
      "test-device",
      expect.objectContaining({ audio: { flac: true } }),
    ));
  });

  it("offers common ffprobe subtitle formats and stores the selected format id", async () => {
    vi.spyOn(api, "hardwareProfiles").mockResolvedValue([
      {
        ...profile(),
        catalog_source: "local",
        subtitles: { srt: true },
      },
    ]);
    vi.spyOn(api, "softwareProfiles").mockResolvedValue([]);
    vi.spyOn(api, "compatibilityProfiles").mockResolvedValue([]);
    const updateProfile = vi.spyOn(api, "updateHardwareProfile").mockResolvedValue(profile());

    render(<CompatibilityProfilesPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit profile Test Device" }));
    fireEvent.click(screen.getByText("Subtitle support"));

    const subtitleFormat = screen.getByLabelText("Format");
    expect(subtitleFormat).toHaveValue("srt");
    expect(screen.getByRole("option", { name: "Blu-ray PGS (hdmv_pgs_subtitle)" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "DVD VobSub (dvd_subtitle)" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "EIA-608 Closed Captions (eia_608)" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "MOV / MP4 Timed Text (mov_text)" })).toBeInTheDocument();

    fireEvent.change(subtitleFormat, { target: { value: "webvtt" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(updateProfile).toHaveBeenCalledWith(
      "test-device",
      expect.objectContaining({ subtitles: { webvtt: true } }),
    ));
  });
});
