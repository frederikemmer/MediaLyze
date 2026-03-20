declare const __APP_VERSION__: string;

type MediaLyzeDesktopBridge = {
  isDesktop: () => boolean;
  selectLibraryPath: () => Promise<string | null>;
};

interface Window {
  medialyzeDesktop?: MediaLyzeDesktopBridge;
}
