declare const __APP_VERSION__: string;

type MediaLyzeDesktopBridge = {
  isDesktop: () => boolean;
  selectLibraryPaths: () => Promise<string[]>;
  openExternalUrl?: (url: string) => Promise<boolean>;
  downloadLatestInstaller?: (version: string) => Promise<{
    ok: boolean;
    path?: string;
    filename?: string;
    error?: string;
  }>;
};

interface Window {
  medialyzeDesktop?: MediaLyzeDesktopBridge;
}
