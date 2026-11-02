import type { ReactNode } from "react";
import { NavLink } from "react-router";
import { useTranslation } from "react-i18next";
import { APP_VERSION } from "../lib/app-version";

export function HeaderBrand({ children }: { children?: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="app-title-block">
      <NavLink to="/" end className="app-title-link" aria-label={`${t("app.title")} ${t("nav.homeAria")}`}>
        <h1><span className="app-title-text">{t("app.title")}</span><img className="app-title-icon" src="/favicon.svg" alt="" /></h1>
      </NavLink>
      {children ?? <span className="app-version">{APP_VERSION === "dev" ? "dev" : `v${APP_VERSION}`}</span>}
    </div>
  );
}
