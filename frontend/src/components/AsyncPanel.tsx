import type { ReactNode } from "react";

type AsyncPanelProps = {
  title: string;
  subtitle?: string;
  loading?: boolean;
  error?: string | null;
  bodyClassName?: string;
  headerAddon?: ReactNode;
  children: ReactNode;
};

export function AsyncPanel({
  title,
  subtitle,
  loading,
  error,
  bodyClassName,
  headerAddon,
  children,
}: AsyncPanelProps) {
  return (
    <section className="panel async-panel">
      <div className="panel-header">
        <div>
          <div className="panel-title-row">
            <h2>{title}</h2>
            {headerAddon}
          </div>
          {subtitle ? <p className="subtitle">{subtitle}</p> : null}
        </div>
      </div>
      <div className={`async-panel-body ${bodyClassName ?? ""}`.trim()}>
        {loading ? <div className="notice">Loading…</div> : null}
        {error ? <div className="alert">{error}</div> : null}
        {!loading && !error ? children : null}
      </div>
    </section>
  );
}
