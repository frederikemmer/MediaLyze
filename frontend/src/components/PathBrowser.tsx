import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { api, type BrowseResponse } from "../lib/api";

type PathBrowserProps = {
  value: string;
  selectedPaths: string[];
  onChange: (value: string) => void;
  onAddPath: (value: string) => void;
  onRemovePath: (value: string) => void;
};

function isRootPath(path: string | null | undefined): boolean {
  return !path || path === ".";
}

export function PathBrowser({ value, selectedPaths, onChange, onAddPath, onRemovePath }: PathBrowserProps) {
  const { t } = useTranslation();
  const [browser, setBrowser] = useState<BrowseResponse | null>(null);
  const [currentPath, setCurrentPath] = useState<string>(value || ".");
  const [error, setError] = useState<string | null>(null);
  const currentPathLabel = isRootPath(browser?.current_path) ? null : (browser?.current_path ?? currentPath);

  useEffect(() => {
    setCurrentPath(value || ".");
  }, [value]);

  useEffect(() => {
    let cancelled = false;
    api
      .browse(currentPath)
      .then((payload) => {
        if (!cancelled) {
          setBrowser(payload);
          setError(null);
        }
      })
      .catch((reason: Error) => {
        if (!cancelled) {
          setError(reason.message);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [currentPath]);

  return (
    <div className="stack">
      <div className="meta-row">
        <span className="meta-label">{t("pathBrowser.selected")}</span>
        <div className="path-browser-selected-list">
          {selectedPaths.length ? selectedPaths.map((path) => (
            <span key={path} className="path-browser-selected-item badge">
              <span>{path}</span>
              <span className="path-browser-pill-divider" aria-hidden="true" />
              <button
                type="button"
                className="path-browser-pill-remove"
                onClick={() => onRemovePath(path)}
                aria-label={t("pathBrowser.remove")}
              >
                ×
              </button>
            </span>
          )) : <div className="badge">{t("pathBrowser.noneSelected")}</div>}
        </div>
      </div>
      {error ? <div className="alert">{error}</div> : null}
      <div className="path-browser">
        <div className="toolbar">
          <strong>{currentPathLabel ?? ""}</strong>
          <div className="toolbar-actions">
            <button
              type="button"
              className="secondary small"
              onClick={() => onAddPath(currentPath)}
            >
              {t("pathBrowser.addCurrent")}
            </button>
            {browser?.parent_path ? (
              <button
                type="button"
                className="secondary small"
                onClick={() => {
                  setCurrentPath(browser.parent_path ?? ".");
                  onChange(browser.parent_path ?? ".");
                }}
              >
                {t("pathBrowser.up")}
              </button>
            ) : null}
          </div>
        </div>
        <div className="listing path-list">
          {browser?.entries.filter((entry) => entry.is_dir).map((entry) => (
            <button
              key={entry.path}
              type="button"
              className={`ghost path-entry ${value === entry.path ? "active" : ""}`.trim()}
              onClick={() => {
                setCurrentPath(entry.path);
                onChange(entry.path);
              }}
            >
              <span>{entry.name}</span>
              <span className="subtitle">{entry.path}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
