export type DesktopBridge = {
  isDesktop: () => boolean;
  selectLibraryPaths: () => Promise<string[]>;
  openExternalUrl?: (url: string) => Promise<boolean>;
  downloadLatestInstaller?: (version: string) => Promise<DesktopInstallerDownloadResult>;
};

export type DesktopInstallerDownloadResult = {
  ok: boolean;
  path?: string;
  filename?: string;
  error?: string;
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
