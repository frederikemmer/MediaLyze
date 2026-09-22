import { useId, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight } from "lucide-react";

import { LoaderPinwheelIcon } from "./LoaderPinwheelIcon";
import { TooltipTrigger } from "./TooltipTrigger";

type AsyncPanelProps = {
  title: string;
  titleTooltip?: ReactNode;
  titleTooltipAriaLabel?: string;
  subtitle?: string;
  subtitleAddon?: ReactNode;
  loading?: boolean;
  refreshing?: boolean;
  refreshError?: string | null;
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
    disabled?: boolean;
  };
  children: ReactNode;
};

export function AsyncPanel({
  title,
  titleTooltip,
  titleTooltipAriaLabel,
  subtitle,
  subtitleAddon,
  loading,
  refreshing = false,
  refreshError = null,
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
  const collapseDisabled = collapseState?.disabled ?? false;
  const ToggleIcon = isCollapsed ? ChevronRight : ChevronDown;
  const hasHeaderLead = Boolean(collapseState || title || titleAddon || subtitle || subtitleAddon);
  const useTitleTooltipTrigger = Boolean(titleTooltip);
  const titleToggleClassName = [
    "async-panel-toggle",
    collapseActions ? "has-collapse-actions" : "",
    useTitleTooltipTrigger ? "async-panel-title-tooltip-trigger" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const titleToggleContent = (
    <>
      <span>{title}</span>
      {!collapseActions && !collapseDisabled ? <ToggleIcon aria-hidden="true" className="nav-icon" /> : null}
    </>
  );

  return (
    <section className={`panel async-panel${isCollapsed ? " is-collapsed" : ""}${className ? ` ${className}` : ""}`}>
      <div className="panel-header">
        {hasHeaderLead ? (
          <div>
            <div className="panel-title-row">
              {collapseState ? (
                <>
                  <h2 className="async-panel-toggle-heading">
                    {useTitleTooltipTrigger ? (
                      <TooltipTrigger
                        as="span"
                        ariaLabel={titleTooltipAriaLabel ?? title}
                        ariaExpanded={!isCollapsed}
                        ariaControls={bodyId}
                        ariaDisabled
                        className="async-panel-title-tooltip-wrapper"
                        content={titleTooltip}
                        pinOnClick={false}
                      >
                        <button
                          type="button"
                          className={titleToggleClassName}
                          aria-expanded={!isCollapsed}
                          aria-controls={bodyId}
                          disabled
                          title={typeof titleTooltip === "string" ? titleTooltip : undefined}
                          onClick={collapseState.onToggle}
                        >
                          {titleToggleContent}
                        </button>
                      </TooltipTrigger>
                    ) : (
                      <button
                        type="button"
                        className={titleToggleClassName}
                        aria-expanded={!isCollapsed}
                        aria-controls={bodyId}
                        disabled={collapseDisabled}
                        title={typeof titleTooltip === "string" ? titleTooltip : undefined}
                        onClick={collapseState.onToggle}
                      >
                        {titleToggleContent}
                      </button>
                    )}
                  </h2>
                  {collapseActions ? (
                    <div className="async-panel-toggle-actions">
                      {collapseActions}
                      {!collapseDisabled ? (
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
                      ) : null}
                    </div>
                  ) : null}
                </>
              ) : title ? (
                <h2>{title}</h2>
              ) : null}
              {titleAddon}
              {!collapseState && collapseActions ? (
                <div className="async-panel-toggle-actions">
                  {collapseActions}
                </div>
              ) : null}
            </div>
            {subtitleAddon}
            {subtitle && !isCollapsed ? <p className="subtitle">{subtitle}</p> : null}
          </div>
        ) : null}
        {refreshing || headerAddon ? (
          <div className="async-panel-header-status">
            {refreshing ? (
              <span className="async-panel-refreshing" role="status" aria-live="polite">
                <LoaderPinwheelIcon className="async-panel-refreshing-icon" size={16} />
                <span>{t("panel.refreshing")}</span>
              </span>
            ) : null}
            {headerAddon}
          </div>
        ) : null}
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
          {!loading && !error ? (
            <>
              {refreshError ? <div className="alert async-panel-refresh-error">{refreshError}</div> : null}
              {children}
            </>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
