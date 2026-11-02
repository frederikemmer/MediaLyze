import { preferenceStorage } from "./preference-storage";
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
export const RELEASE_NOTES_SEEN_APP_VERSION_STORAGE_KEY = "medialyze-release-notes-seen-app-version";
export const UPDATE_REMINDER_STORAGE_KEY = "medialyze-update-reminder-v1";
export const UPDATE_REMINDER_INTERVAL_MS = 72 * 60 * 60 * 1000;

export type UpdateReminder = {
  version: string;
  remindedAt: string;
};

export type BrowserUpdateReminderState = {
  available: boolean;
  reminder: UpdateReminder | null;
};

export function normalizeReleaseVersion(version: string): string {
  return version.trim().replace(/^v/i, "");
}

export function isDevelopmentVersion(version: string): boolean {
  const normalizedVersion = normalizeReleaseVersion(version);
  return normalizedVersion === "dev" || /(?:^|-)dev[0-9a-z.+-]*$/i.test(normalizedVersion);
}

function canUseLocalStorage(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  const probeKey = `${UPDATE_REMINDER_STORAGE_KEY}-probe`;
  try {
    preferenceStorage.setItem(probeKey, "1");
    preferenceStorage.removeItem(probeKey);
    return true;
  } catch {
    return false;
  }
}

export function readBrowserUpdateReminder(now = Date.now()): BrowserUpdateReminderState {
  if (!canUseLocalStorage()) {
    return { available: false, reminder: null };
  }
  try {
    const stored = preferenceStorage.getItem(UPDATE_REMINDER_STORAGE_KEY);
    if (!stored) {
      return { available: true, reminder: null };
    }
    const parsed = JSON.parse(stored) as Partial<UpdateReminder>;
    const remindedAtMs = typeof parsed.remindedAt === "string" ? Date.parse(parsed.remindedAt) : Number.NaN;
    const version = typeof parsed.version === "string" ? normalizeReleaseVersion(parsed.version) : "";
    if (
      !/^\d+\.\d+\.\d+$/.test(version)
      || !Number.isFinite(remindedAtMs)
      || remindedAtMs > now
    ) {
      preferenceStorage.removeItem(UPDATE_REMINDER_STORAGE_KEY);
      return { available: true, reminder: null };
    }
    return {
      available: true,
      reminder: { version, remindedAt: new Date(remindedAtMs).toISOString() },
    };
  } catch {
    try {
      preferenceStorage.removeItem(UPDATE_REMINDER_STORAGE_KEY);
    } catch {
      return { available: false, reminder: null };
    }
    return { available: true, reminder: null };
  }
}

export function isUpdateReminderDue(remindedAt: string | null, now = Date.now()): boolean {
  if (!remindedAt) {
    return true;
  }
  const remindedAtMs = Date.parse(remindedAt);
  return Number.isFinite(remindedAtMs) && remindedAtMs <= now && now - remindedAtMs >= UPDATE_REMINDER_INTERVAL_MS;
}

export function markBrowserUpdateReminder(version: string, now = Date.now()): boolean {
  if (!canUseLocalStorage()) {
    return false;
  }
  try {
    preferenceStorage.setItem(
      UPDATE_REMINDER_STORAGE_KEY,
      JSON.stringify({
        version: normalizeReleaseVersion(version),
        remindedAt: new Date(now).toISOString(),
      } satisfies UpdateReminder),
    );
    return true;
  } catch {
    return false;
  }
}

function cleanMarkdownText(value: string): string {
  return value
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanReleaseNoteItemText(value: string): string {
  return value
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseReleaseNotes(markdown: string, version: string): ReleaseNotes | null {
  const normalizedVersion = normalizeReleaseVersion(version);
  if (!normalizedVersion || isDevelopmentVersion(normalizedVersion)) {
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
      currentSection.items.push(cleanReleaseNoteItemText(itemMatch[1]));
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
  if (isDevelopmentVersion(APP_VERSION)) {
    return getAllReleaseNotes()[0] ?? null;
  }
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
  if (!releaseNotes || typeof window === "undefined") {
    return false;
  }
  return preferenceStorage.getItem(RELEASE_NOTES_SEEN_APP_VERSION_STORAGE_KEY) !== normalizeReleaseVersion(version);
}

export function isFirstOpenAfterUpdate(version: string, releaseNotes: ReleaseNotes | null): boolean {
  if (!releaseNotes || typeof window === "undefined") {
    return false;
  }
  const seenAppVersion = preferenceStorage.getItem(RELEASE_NOTES_SEEN_APP_VERSION_STORAGE_KEY);
  if (seenAppVersion !== null) {
    return seenAppVersion !== normalizeReleaseVersion(version);
  }
  // Legacy installs stored only the displayed release section. Treat that as a prior visit once.
  return preferenceStorage.getItem(RELEASE_NOTES_SEEN_VERSION_STORAGE_KEY) !== null;
}

export function getSeenReleaseVersion(version: string, releaseNotes: ReleaseNotes | null): string {
  return isDevelopmentVersion(version) && releaseNotes ? releaseNotes.version : normalizeReleaseVersion(version);
}

export function markReleaseNotesSeen(version: string, releaseNotes: ReleaseNotes | null = null): void {
  if (typeof window === "undefined") {
    return;
  }
  preferenceStorage.setItem(RELEASE_NOTES_SEEN_APP_VERSION_STORAGE_KEY, normalizeReleaseVersion(version));
  preferenceStorage.setItem(RELEASE_NOTES_SEEN_VERSION_STORAGE_KEY, getSeenReleaseVersion(version, releaseNotes));
}
