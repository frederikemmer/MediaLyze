import i18n, { type BackendModule } from "i18next";
import { initReactI18next } from "react-i18next";
import commonEn from "../locales/en/common.json";

export const LANGUAGE_STORAGE_KEY = "medialyze-language";
export const SUPPORTED_INTERFACE_LANGUAGES = ["en", "de", "es", "uk"] as const;
export type SupportedInterfaceLanguage = (typeof SUPPORTED_INTERFACE_LANGUAGES)[number];

export function isSupportedInterfaceLanguage(language: string): language is SupportedInterfaceLanguage {
  return SUPPORTED_INTERFACE_LANGUAGES.includes(language as SupportedInterfaceLanguage);
}

export function getStoredInterfaceLanguage(): SupportedInterfaceLanguage | null {
  if (typeof window === "undefined") {
    return null;
  }

  const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
  return stored && isSupportedInterfaceLanguage(stored) ? stored : null;
}

function getInitialLanguage(): SupportedInterfaceLanguage {
  const stored = getStoredInterfaceLanguage();
  if (stored) {
    return stored;
  }

  return "en";
}

const languageLoaders = {
  de: () => import("../locales/de/common.json"),
  es: () => import("../locales/es/common.json"),
  uk: () => import("../locales/uk/common.json"),
};

const languageBackend: BackendModule = {
  type: "backend",
  init() {},
  read(language, _namespace, callback) {
    if (language === "en") {
      callback(null, commonEn);
      return;
    }
    const loader = languageLoaders[language as keyof typeof languageLoaders];
    if (!loader) {
      callback(new Error("Unsupported interface language"), false);
      return;
    }
    void loader().then((module) => callback(null, module.default), (error) => callback(error, false));
  },
};

export const i18nReady = i18n.use(languageBackend).use(initReactI18next).init({
  resources: { en: { common: commonEn } },
  partialBundledLanguages: true,
  supportedLngs: [...SUPPORTED_INTERFACE_LANGUAGES],
  ns: ["common"],
  defaultNS: "common",
  fallbackLng: "en",
  lng: getInitialLanguage(),
  interpolation: { escapeValue: false },
});

if (typeof document !== "undefined") {
  document.documentElement.lang = i18n.language;
}

i18n.on("languageChanged", (language) => {
  if (typeof document !== "undefined") {
    document.documentElement.lang = language;
  }

  if (typeof window !== "undefined") {
    if (isSupportedInterfaceLanguage(language)) {
      window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
    }
  }
});

export default i18n;
