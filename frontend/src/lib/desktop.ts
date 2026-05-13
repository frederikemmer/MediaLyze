export type DesktopBridge = {
  isDesktop: () => boolean;
  selectLibraryPaths: () => Promise<string[]>;
  openExternalUrl?: (url: string) => Promise<boolean>;
};

export function getDesktopBridge(): DesktopBridge | null {
  if (typeof window === "undefined") {
    return null;
  }
  return window.medialyzeDesktop ?? null;
}


export function isDesktopApp(): boolean {
  return getDesktopBridge()?.isDesktop() ?? false;
}
