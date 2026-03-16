import { useId, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

type AsyncPanelProps = {
  title: string;
  subtitle?: string;
  loading?: boolean;
  error?: string | null;
  bodyClassName?: string;
  titleAddon?: ReactNode;
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
  loading,
  error,
  bodyClassName,
  titleAddon,
  headerAddon,
  collapseState,
  children,
}: AsyncPanelProps) {
  const generatedBodyId = useId();
  const bodyId = collapseState?.bodyId ?? `async-panel-body-${generatedBodyId}`;
  const isCollapsed = collapseState?.collapsed ?? false;
  const ToggleIcon = isCollapsed ? ChevronRight : ChevronDown;

  return (
    <section className={`panel async-panel${isCollapsed ? " is-collapsed" : ""}`}>
      <div className="panel-header">
        <div>
          <div className="panel-title-row">
            {collapseState ? (
              <h2 className="async-panel-toggle-heading">
                <button
                  type="button"
                  className="async-panel-toggle"
                  aria-expanded={!isCollapsed}
                  aria-controls={bodyId}
                  onClick={collapseState.onToggle}
                >
                  <span>{title}</span>
                  <ToggleIcon aria-hidden="true" className="nav-icon" />
                </button>
              </h2>
            ) : (
              <h2>{title}</h2>
            )}
            {titleAddon}
          </div>
          {subtitle && !isCollapsed ? <p className="subtitle">{subtitle}</p> : null}
        </div>
        {headerAddon}
      </div>
      {!isCollapsed ? (
        <div id={bodyId} className={`async-panel-body ${bodyClassName ?? ""}`.trim()}>
          {loading ? <div className="notice">Loading…</div> : null}
          {error ? <div className="alert">{error}</div> : null}
          {!loading && !error ? children : null}
        </div>
      ) : null}
    </section>
  );
}
