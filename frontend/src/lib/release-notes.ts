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

export function normalizeReleaseVersion(version: string): string {
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
  const normalizedVersion = normalizeReleaseVersion(version);
  if (!normalizedVersion || normalizedVersion === "dev") {
    return null;
  }

  return parseAllReleaseNotes(markdown).find((releaseNotes) => releaseNotes.version === normalizedVersion) ?? null;
}

function parseReleaseNotesBlock(version: string, block: string): ReleaseNotes | null {
  const releaseNotes: ReleaseNotes = {
    version,
    date: null,
    sections: [],
  };
  let currentSection: ReleaseNotesSection | null = null;

  for (const rawLine of block.split(/\r?\n/)) {
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

export function parseAllReleaseNotes(markdown: string): ReleaseNotes[] {
  const headingPattern = /^##\s+v([0-9][^\s]*)\s*$/gm;
  const headings = [...markdown.matchAll(headingPattern)];
  return headings.flatMap((heading, index) => {
    if (typeof heading.index !== "number") {
      return [];
    }

    const version = normalizeReleaseVersion(heading[1]);
    const sectionStart = heading.index + heading[0].length;
    const nextHeading = headings[index + 1];
    const sectionEnd = typeof nextHeading?.index === "number" ? nextHeading.index : markdown.length;
    const releaseNotes = parseReleaseNotesBlock(version, markdown.slice(sectionStart, sectionEnd));
    return releaseNotes ? [releaseNotes] : [];
  });
}

export function getCurrentReleaseNotes(): ReleaseNotes | null {
  return parseReleaseNotes(changelogMarkdown, APP_VERSION);
}

export function getAllReleaseNotes(): ReleaseNotes[] {
  return parseAllReleaseNotes(changelogMarkdown);
}

export function compareReleaseVersions(left: string, right: string): number {
  const leftParts = normalizeReleaseVersion(left).split(".").map(Number);
  const rightParts = normalizeReleaseVersion(right).split(".").map(Number);
  if (leftParts.length !== 3 || rightParts.length !== 3 || [...leftParts, ...rightParts].some(Number.isNaN)) {
    return 0;
  }
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) {
      return leftParts[index] - rightParts[index];
    }
  }
  return 0;
}

export function mergeReleaseNotes(localNotes: ReleaseNotes[], remoteNotes: ReleaseNotes[]): ReleaseNotes[] {
  const notesByVersion = new Map(localNotes.map((notes) => [notes.version, notes]));
  for (const notes of remoteNotes) {
    notesByVersion.set(notes.version, notes);
  }
  return [...notesByVersion.values()].sort((left, right) => compareReleaseVersions(right.version, left.version));
}

export function shouldShowReleaseNotes(version: string, releaseNotes: ReleaseNotes | null): boolean {
  if (!releaseNotes || normalizeReleaseVersion(version) === "dev" || typeof window === "undefined") {
    return false;
  }
  return window.localStorage.getItem(RELEASE_NOTES_SEEN_VERSION_STORAGE_KEY) !== normalizeReleaseVersion(version);
}

export function isFirstOpenAfterUpdate(version: string, releaseNotes: ReleaseNotes | null): boolean {
  if (!releaseNotes || normalizeReleaseVersion(version) === "dev" || typeof window === "undefined") {
    return false;
  }
  const seenVersion = window.localStorage.getItem(RELEASE_NOTES_SEEN_VERSION_STORAGE_KEY);
  return Boolean(seenVersion && seenVersion !== normalizeReleaseVersion(version));
}

export function markReleaseNotesSeen(version: string): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(RELEASE_NOTES_SEEN_VERSION_STORAGE_KEY, normalizeReleaseVersion(version));
}
