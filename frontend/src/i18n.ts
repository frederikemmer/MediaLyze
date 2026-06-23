import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import commonEn from "../locales/en/common.json";
import commonDe from "../locales/de/common.json";
import commonEs from "../locales/es/common.json";
import commonUk from "../locales/uk/common.json";

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

const resources = {
  en: {
    common: commonEn,
  },
  de: {
    common: commonDe,
  },
  es: {
    common: commonEs,
  },
  uk: {
    common: commonUk,
  },
};

void i18n.use(initReactI18next).init({
  resources,
  ns: ["common"],
  defaultNS: "common",
  fallbackLng: "en",
  lng: getInitialLanguage(),
  interpolation: {
    escapeValue: false,
  },
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
