import changelogMarkdown from "../../../CHANGELOG.md?raw";

import { APP_VERSION } from "./app-version";

export type ReleaseNotesSection = {
  title: string;
  items: string[];
};

export type ReleaseNotes = {
  version: string;
  date: string | null;
  sections: ReleaseNotesSection[];
};

export const RELEASE_NOTES_SEEN_VERSION_STORAGE_KEY = "medialyze-release-notes-seen-version";

function normalizeVersion(version: string): string {
  return version.trim().replace(/^v/i, "");
}

function cleanMarkdownText(value: string): string {
  return value
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseReleaseNotes(markdown: string, version: string): ReleaseNotes | null {
  const normalizedVersion = normalizeVersion(version);
  if (!normalizedVersion || normalizedVersion === "dev") {
    return null;
  }

  const headingPattern = new RegExp(`^##\\s+v?${normalizedVersion.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "m");
  const headingMatch = markdown.match(headingPattern);
  if (!headingMatch || typeof headingMatch.index !== "number") {
    return null;
  }

  const sectionStart = headingMatch.index + headingMatch[0].length;
  const nextHeadingMatch = markdown.slice(sectionStart).match(/^##\s+/m);
  const sectionEnd = nextHeadingMatch?.index === undefined ? markdown.length : sectionStart + nextHeadingMatch.index;
  const lines = markdown.slice(sectionStart, sectionEnd).split(/\r?\n/);
  const releaseNotes: ReleaseNotes = {
    version: normalizedVersion,
    date: null,
    sections: [],
  };
  let currentSection: ReleaseNotesSection | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    const dateMatch = line.match(/^>\s*(.+)$/);
    if (dateMatch) {
      releaseNotes.date = cleanMarkdownText(dateMatch[1]);
      continue;
    }

    const sectionMatch = line.match(/^###\s+(.+)$/);
    if (sectionMatch) {
      currentSection = { title: cleanMarkdownText(sectionMatch[1]), items: [] };
      releaseNotes.sections.push(currentSection);
      continue;
    }

    const itemMatch = line.match(/^-\s+(.+)$/);
    if (itemMatch) {
      if (!currentSection) {
        currentSection = { title: "", items: [] };
        releaseNotes.sections.push(currentSection);
      }
      currentSection.items.push(cleanMarkdownText(itemMatch[1]));
    }
  }

  return releaseNotes.sections.some((section) => section.items.length > 0) ? releaseNotes : null;
}

export function getCurrentReleaseNotes(): ReleaseNotes | null {
  return parseReleaseNotes(changelogMarkdown, APP_VERSION);
}

export function shouldShowReleaseNotes(version: string, releaseNotes: ReleaseNotes | null): boolean {
  if (!releaseNotes || normalizeVersion(version) === "dev" || typeof window === "undefined") {
    return false;
  }
  return window.localStorage.getItem(RELEASE_NOTES_SEEN_VERSION_STORAGE_KEY) !== normalizeVersion(version);
}

export function markReleaseNotesSeen(version: string): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(RELEASE_NOTES_SEEN_VERSION_STORAGE_KEY, normalizeVersion(version));
}
