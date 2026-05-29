import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import commonEn from "../locales/en/common.json";
import commonDe from "../locales/de/common.json";
import commonEs from "../locales/es/common.json";

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
  lng: "en",
  interpolation: {
    escapeValue: false,
  },
});

i18n.on("languageChanged", (language) => {
  if (typeof document !== "undefined") {
    document.documentElement.lang = language;
  }
});

export default i18n;
