import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import commonEn from "../locales/en/common.json";
import commonDe from "../locales/de/common.json";
import commonEs from "../locales/es/common.json";

const LANGUAGE_STORAGE_KEY = "medialyze-language";

function getInitialLanguage(): "en" | "de" | "es" {
  if (typeof window !== "undefined") {
    const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (stored === "en" || stored === "de" || stored === "es") {
      return stored;
    }
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
    if (language === "en" || language === "de" || language === "es") {
      window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
    }
  }
});

export default i18n;
