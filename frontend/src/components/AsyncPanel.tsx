import { useId, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight } from "lucide-react";

import { LoaderPinwheelIcon } from "./LoaderPinwheelIcon";

type AsyncPanelProps = {
  title: string;
  subtitle?: string;
  subtitleAddon?: ReactNode;
  loading?: boolean;
  error?: string | null;
  className?: string;
  bodyClassName?: string;
  titleAddon?: ReactNode;
  collapseActions?: ReactNode;
  collapseButtonClassName?: string;
  headerAddon?: ReactNode;
  collapseState?: {
    collapsed: boolean;
    onToggle: () => void;
    bodyId?: string;
  };
  children: ReactNode;
};

export function AsyncPanel({
  title,
  subtitle,
  subtitleAddon,
  loading,
  error,
  className,
  bodyClassName,
  titleAddon,
  collapseActions,
  collapseButtonClassName,
  headerAddon,
  collapseState,
  children,
}: AsyncPanelProps) {
  const { t } = useTranslation();
  const generatedBodyId = useId();
  const bodyId = collapseState?.bodyId ?? `async-panel-body-${generatedBodyId}`;
  const isCollapsed = collapseState?.collapsed ?? false;
  const ToggleIcon = isCollapsed ? ChevronRight : ChevronDown;
  const hasHeaderLead = Boolean(collapseState || title || titleAddon || subtitle || subtitleAddon);

  return (
    <section className={`panel async-panel${isCollapsed ? " is-collapsed" : ""}${className ? ` ${className}` : ""}`}>
      <div className="panel-header">
        {hasHeaderLead ? (
          <div>
            <div className="panel-title-row">
              {collapseState ? (
                <>
                  <h2 className="async-panel-toggle-heading">
                    <button
                      type="button"
                      className={`async-panel-toggle${collapseActions ? " has-collapse-actions" : ""}`}
                      aria-expanded={!isCollapsed}
                      aria-controls={bodyId}
                      onClick={collapseState.onToggle}
                    >
                      <span>{title}</span>
                      {!collapseActions ? <ToggleIcon aria-hidden="true" className="nav-icon" /> : null}
                    </button>
                  </h2>
                  {collapseActions ? (
                    <div className="async-panel-toggle-actions">
                      {collapseActions}
                      <button
                        type="button"
                        className={`secondary icon-only-button async-panel-toggle-icon-button${collapseButtonClassName ? ` ${collapseButtonClassName}` : ""}`}
                        aria-label={
                          isCollapsed
                            ? t("panel.expandAria", { title })
                            : t("panel.collapseAria", { title })
                        }
                        aria-expanded={!isCollapsed}
                        aria-controls={bodyId}
                        onClick={collapseState.onToggle}
                      >
                        <ToggleIcon aria-hidden="true" className="nav-icon" />
                      </button>
                    </div>
                  ) : null}
                </>
              ) : title ? (
                <h2>{title}</h2>
              ) : null}
              {titleAddon}
            </div>
            {subtitleAddon}
            {subtitle && !isCollapsed ? <p className="subtitle">{subtitle}</p> : null}
          </div>
        ) : null}
        {headerAddon}
      </div>
      {!isCollapsed ? (
        <div id={bodyId} className={`async-panel-body ${bodyClassName ?? ""}`.trim()}>
          {loading ? (
            <div className="panel-loader" role="status" aria-live="polite">
              <LoaderPinwheelIcon className="panel-loader-icon" size={30} />
              <span>{t("panel.loading")}</span>
            </div>
          ) : null}
          {error ? <div className="alert">{error}</div> : null}
          {!loading && !error ? children : null}
        </div>
      ) : null}
    </section>
  );
}
