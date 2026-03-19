export type DesktopBridge = {
  isDesktop: () => boolean;
  selectLibraryPath: () => Promise<string | null>;
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
