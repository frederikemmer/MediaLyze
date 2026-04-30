declare const __APP_VERSION__: string;

type MediaLyzeDesktopBridge = {
  isDesktop: () => boolean;
  selectLibraryPaths: () => Promise<string[]>;
};

interface Window {
  medialyzeDesktop?: MediaLyzeDesktopBridge;
}
