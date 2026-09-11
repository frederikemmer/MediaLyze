import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowUp, Plus, X } from "lucide-react";

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
  const canNavigateUp = Boolean(browser?.parent_path) || Boolean(error && !isRootPath(currentPath));

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
          setBrowser(null);
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
            <div key={path} className="path-browser-selected-item">
              <span className="path-browser-selected-path">{path}</span>
              <button
                type="button"
                className="secondary icon-only-button path-browser-selected-remove"
                onClick={() => onRemovePath(path)}
                title={t("pathBrowser.remove")}
                aria-label={t("pathBrowser.remove")}
              >
                <X aria-hidden="true" />
              </button>
            </div>
          )) : <div className="path-browser-empty-selection">{t("pathBrowser.noneSelected")}</div>}
        </div>
      </div>
      {error ? <div className="alert">{error}</div> : null}
      <div className="path-browser">
        <div className="toolbar">
          <div className="path-browser-current-location">
            <strong>{currentPathLabel ?? t("pathBrowser.root")}</strong>
            {canNavigateUp ? (
              <button
                type="button"
                className="secondary icon-only-button path-browser-up-button"
                onClick={() => {
                  const nextPath = browser?.parent_path ?? ".";
                  setCurrentPath(nextPath);
                  onChange(nextPath);
                }}
                title={t("pathBrowser.up")}
                aria-label={t("pathBrowser.up")}
              >
                <ArrowUp aria-hidden="true" />
              </button>
            ) : null}
          </div>
          <div className="toolbar-actions">
            <button
              type="button"
              className="history-retention-primary-button small path-browser-add-button"
              onClick={() => onAddPath(currentPath)}
            >
              <Plus aria-hidden="true" />
              {t("pathBrowser.addCurrent")}
            </button>
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
