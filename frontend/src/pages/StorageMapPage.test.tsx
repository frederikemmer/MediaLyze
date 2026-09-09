import "../i18n";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";

import { api, type LibraryStorageMap, type StorageMapNode } from "../lib/api";
import { layoutStorageMapNodes, StorageMapPage } from "./StorageMapPage";

const appDataMock = vi.hoisted(() => ({
  value: {
    libraries: [
      {
        id: 1,
        name: "Movies",
        linked_jellyfin_library: {
          id: 7,
          name: "Movies",
          last_synced_at: "2026-07-28T08:00:00Z",
        },
      },
    ],
    librariesLoaded: true,
  } as {
    libraries: Array<{
      id: number;
      name: string;
      linked_jellyfin_library?: {
        id: number;
        name: string;
        last_synced_at: string;
      };
    }>;
    librariesLoaded: boolean;
  },
}));

vi.mock("../lib/app-data", () => ({
  useAppData: () => appDataMock.value,
}));

function storageNode(overrides: Partial<StorageMapNode>): StorageMapNode {
  return {
    kind: "file",
    name: "Movie.mkv",
    path: "Movie.mkv",
    size_bytes: 100,
    file_count: 1,
    file_id: 1,
    extension: "mkv",
    jellyfin_title: null,
    video_codec: "hevc",
    resolution: "3840x2160",
    resolution_category_id: "uhd",
    resolution_category_label: "4K UHD",
    hdr_type: "HDR10",
    quality_score: 9,
    quality_score_raw: 90,
    container: "mkv",
    duration_seconds: 7200,
    bitrate: 12_000_000,
    audio_bitrate: 640_000,
    audio_codec: "eac3",
    audio_channels: 6,
    frame_rate: 23.976,
    bit_depth: 10,
    audio_language: "eng",
    subtitle_status: "internal",
    subtitle_language: "eng",
    analysis_status: "ready",
    color_distributions: {},
    ...overrides,
  };
}

function storageMap(overrides: Partial<LibraryStorageMap>): LibraryStorageMap {
  return {
    library_id: 1,
    library_name: "Movies",
    path: "",
    total_size_bytes: 100,
    file_count: 1,
    breadcrumbs: [{ name: "Movies", path: "" }],
    items: [],
    ...overrides,
  };
}

beforeEach(() => {
  appDataMock.value = {
    libraries: [
      {
        id: 1,
        name: "Movies",
        linked_jellyfin_library: {
          id: 7,
          name: "Movies",
          last_synced_at: "2026-07-28T08:00:00Z",
        },
      },
    ],
    librariesLoaded: true,
  };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("StorageMapPage", () => {
  it("uses every available pixel in proportion to node size", () => {
    const rects = layoutStorageMapNodes([
      storageNode({ path: "large", size_bytes: 60 }),
      storageNode({ path: "medium", size_bytes: 30 }),
      storageNode({ path: "small", size_bytes: 10 }),
    ]);

    const totalArea = rects.reduce((sum, rect) => sum + rect.width * rect.height, 0);
    const largeArea = rects.find((rect) => rect.node.path === "large")!.width
      * rects.find((rect) => rect.node.path === "large")!.height;

    expect(totalArea).toBeCloseTo(10_000, 5);
    expect(largeArea / totalArea).toBeCloseTo(0.6, 5);
  });

  it("drills into folders and opens a file detail route", async () => {
    const libraryStorageMap = vi.spyOn(api, "libraryStorageMap").mockImplementation((_id, params) => {
      if (params?.path === "Feature Films") {
        return Promise.resolve(
          storageMap({
            path: "Feature Films",
            breadcrumbs: [
              { name: "Movies", path: "" },
              { name: "Feature Films", path: "Feature Films" },
            ],
            items: [
              storageNode({
                file_id: 42,
                name: "Dune.mkv",
                jellyfin_title: "Dune: Part Two",
                path: "Feature Films/Dune.mkv",
              }),
              storageNode({
                file_id: 43,
                name: "Unmatched.mkv",
                path: "Feature Films/Unmatched.mkv",
              }),
            ],
          }),
        );
      }
      return Promise.resolve(
        storageMap({
          items: [
            storageNode({
              kind: "folder",
              file_id: null,
              name: "Feature Films",
              path: "Feature Films",
              size_bytes: 100,
              color_distributions: {
                codec: [
                  { value: "hevc", size_bytes: 70 },
                  { value: "av1", size_bytes: 30 },
                ],
              },
            }),
          ],
        }),
      );
    });

    render(
      <MemoryRouter initialEntries={["/storage-map?library=1"]}>
        <Routes>
          <Route path="/storage-map" element={<StorageMapPage />} />
          <Route path="/files/:fileId" element={<div>File detail destination</div>} />
        </Routes>
      </MemoryRouter>,
    );

    const selects = [
      screen.getByRole("combobox", { name: "Library" }),
      screen.getByRole("combobox", { name: "Color" }),
      screen.getByRole("combobox", { name: "Order" }),
    ];
    expect(selects[0]).toHaveValue("1");
    selects.forEach((select) => {
      expect(select.parentElement).toHaveClass("storage-map-field");
      expect(select.parentElement?.querySelector("svg")).not.toBeInTheDocument();
    });
    expect(screen.queryByText("Folders")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Up one level" })).not.toBeInTheDocument();

    const folderTile = await screen.findByRole("button", { name: /Open folder Feature Films/i });
    expect(folderTile).not.toHaveAttribute("title");
    const folderColorField = folderTile.querySelector<HTMLElement>(".storage-map-tile-color-field");
    expect(folderColorField?.style.backgroundImage).toContain("radial-gradient");
    expect(folderColorField?.style.backgroundImage).toContain("rgb(27, 153, 139)");
    expect(folderColorField?.style.backgroundImage).toContain("rgb(255, 107, 61)");
    fireEvent.mouseEnter(folderTile);
    const folderTooltip = await screen.findByRole("tooltip");
    expect(folderTooltip).toHaveTextContent("Feature Films");
    expect(folderTooltip).toHaveTextContent("Video codec");
    expect(folderTooltip).toHaveTextContent("Storage");
    fireEvent.mouseLeave(folderTile);
    await waitFor(() => expect(screen.queryByRole("tooltip")).not.toBeInTheDocument());

    fireEvent.click(folderTile);

    await waitFor(() => {
      expect(libraryStorageMap).toHaveBeenLastCalledWith(
        1,
        expect.objectContaining({ path: "Feature Films" }),
      );
    });

    const upButton = screen.getByRole("button", { name: "Up one level" });
    expect(upButton).toHaveTextContent("");
    fireEvent.focus(upButton);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    fireEvent.blur(upButton);
    expect(document.querySelector(".storage-map-footer")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Show Jellyfin names" }));

    expect(
      await screen.findByRole("button", { name: /Open file details for Dune: Part Two/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Open file details for Dune: Part Two/i }),
    ).not.toHaveAttribute("title");
    expect(
      screen.getByRole("button", { name: /Open file details for Unmatched\.mkv/i }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Open file details for Dune: Part Two/i }));

    expect(await screen.findByText("File detail destination")).toBeInTheDocument();
  });

  it("hides the Jellyfin name toggle for an unlinked library", async () => {
    appDataMock.value = {
      libraries: [{ id: 1, name: "Movies" }],
      librariesLoaded: true,
    };
    vi.spyOn(api, "libraryStorageMap").mockResolvedValue(
      storageMap({ items: [storageNode({ name: "Movie.mkv" })] }),
    );

    render(
      <MemoryRouter initialEntries={["/storage-map?library=1"]}>
        <Routes>
          <Route path="/storage-map" element={<StorageMapPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole("button", { name: /Open file details for Movie\.mkv/i }))
      .toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Displayed file name" }))
      .not.toBeInTheDocument();

    const colorSelect = screen.getByRole("combobox", { name: "Color" });
    expect(colorSelect.querySelectorAll("option")).toHaveLength(17);
    fireEvent.change(colorSelect, { target: { value: "audio_codec" } });
    expect(screen.getByText("Dolby Digital Plus")).toBeInTheDocument();
  });

  it("colors quality by the raw score while displaying the rounded score out of ten", async () => {
    vi.spyOn(api, "libraryStorageMap").mockResolvedValue(
      storageMap({
        items: [storageNode({ quality_score: 9, quality_score_raw: 90 })],
      }),
    );

    render(
      <MemoryRouter initialEntries={["/storage-map?library=1&color=quality"]}>
        <Routes>
          <Route path="/storage-map" element={<StorageMapPage />} />
        </Routes>
      </MemoryRouter>,
    );

    const tile = await screen.findByRole("button", { name: /Open file details for Movie\.mkv/i });
    expect(tile.style.getPropertyValue("--storage-map-tile-color")).toBe("hsl(147 48% 37%)");
    expect(tile).toHaveTextContent("9/10");

    fireEvent.mouseEnter(tile);
    expect(await screen.findByRole("tooltip")).toHaveTextContent("9/10");
  });
});
