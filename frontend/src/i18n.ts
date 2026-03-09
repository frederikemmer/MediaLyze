import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import commonEn from "../locales/en/common.json";
import commonDe from "../locales/de/common.json";

const LANGUAGE_STORAGE_KEY = "medialyze-language";

function getInitialLanguage(): string {
  if (typeof window === "undefined") {
    return "en";
  }

  const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
  if (stored === "de" || stored === "en") {
    return stored;
  }
  return "en";
}

void i18n.use(initReactI18next).init({
  resources: {
    en: {
      common: commonEn,
    },
    de: {
      common: commonDe,
    },
  },
  lng: getInitialLanguage(),
  fallbackLng: "en",
  defaultNS: "common",
  interpolation: {
    escapeValue: false,
  },
});

if (typeof window !== "undefined") {
  i18n.on("languageChanged", (language) => {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  });
}

export default i18n;
