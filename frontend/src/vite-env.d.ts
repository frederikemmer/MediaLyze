declare const __APP_VERSION__: string;

type MediaLyzeDesktopBridge = {
  isDesktop: () => boolean;
  selectLibraryPaths: () => Promise<string[]>;
  openExternalUrl?: (url: string) => Promise<boolean>;
};

interface Window {
  medialyzeDesktop?: MediaLyzeDesktopBridge;
}
