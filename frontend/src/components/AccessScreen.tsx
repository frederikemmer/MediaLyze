import { useId, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { HeaderBrand } from "./HeaderBrand";

export function AccessScreen({ mode, children }: { mode: "setup" | "login" | "password"; children: ReactNode }) {
  const { t } = useTranslation();
  const titleId = useId();
  return (
    <div className="layout media-app-shell">
      <div className="bg-shapes" />
      <header className="panel hero-panel">
        <div className="app-header media-header"><HeaderBrand /></div>
      </header>
      <main className="access-login panel" aria-labelledby={mode === "login" ? undefined : titleId} aria-label={mode === "login" ? t("access.login") : undefined}>
        {mode !== "login" && <h1 id={titleId}>{t(mode === "password" ? "access.changePassword" : "access.setup")}</h1>}
        {mode === "setup" && <>
          <p className="muted">{t("access.accountsIntro")}</p>
          <p className="muted">{t("access.setupHint")}</p>
          <p className="muted">{t("access.existingInstallation")}</p>
        </>}
        {mode === "password" && <p className="muted">{t("access.changeRequired")}</p>}
        {children}
      </main>
    </div>
  );
}
