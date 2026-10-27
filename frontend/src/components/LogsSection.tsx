import { ChevronDown, ChevronRight } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

/** Shared collapsible sub-panel for Logs, App settings and the visual catalog. */
export function LogsSection({ id, title, children, actions, subtitle, loading = false, error, defaultOpen = false }: {
  id: string; title: string; children: ReactNode; actions?: ReactNode; subtitle?: string;
  loading?: boolean; error?: string | null; defaultOpen?: boolean;
}) {
  const { t } = useTranslation();
  const bodyId = useId();
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section id={id} tabIndex={-1} className="app-settings-section transcode-automation-section transcode-federation-panel"
      onFocus={(event) => { if (event.target === event.currentTarget) setOpen(true); }}>
      <div className="compatibility-profile-panel transcode-automation-content">
        <div className="transcode-federation-heading">
          <div className="transcode-federation-heading-main">
            <button type="button" className="transcode-federation-section-chevron" aria-expanded={open} aria-controls={bodyId}
              aria-label={t(open ? "panel.collapseAria" : "panel.expandAria", { title })} onClick={() => setOpen(!open)}>
              {open ? <ChevronDown aria-hidden="true" className="nav-icon" /> : <ChevronRight aria-hidden="true" className="nav-icon" />}
            </button>
            <h3>{title}</h3>
          </div>
          {actions ? <div className="transcode-federation-heading-actions">{actions}</div> : null}
        </div>
        {open ? <div id={bodyId} className="transcode-automation-panel-body">
          {subtitle ? <p className="field-hint">{subtitle}</p> : null}
          {loading ? <p className="field-hint" role="status">{t("panel.loading")}</p> : error ? <p className="alert" role="alert">{error}</p> : children}
        </div> : null}
      </div>
    </section>
  );
}

// Generic name for settings pages; both exports use the same DOM and behavior.
export { LogsSection as SettingsSection };
