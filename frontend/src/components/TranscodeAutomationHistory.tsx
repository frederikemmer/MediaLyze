import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, type LibrarySummary, type TranscodeAutomationRun } from "../lib/api";

const key = "transcoding.automation.";

export function TranscodeAutomationHistory({ libraries, requestedRunId }: {
  libraries: LibrarySummary[];
  requestedRunId: number;
}) {
  const { t, i18n } = useTranslation();
  const [runs, setRuns] = useState<TranscodeAutomationRun[]>();
  const [listError, setListError] = useState("");
  const [selection, setSelection] = useState<{ requested: number; id: number }>();
  const selectedId = selection?.requested === requestedRunId ? selection.id : requestedRunId;
  const [detail, setDetail] = useState<{ id: number; run?: TranscodeAutomationRun; error?: string }>();

  useEffect(() => {
    let current = true;
    void api.transcodeAutomationRuns(30).then((result) => {
      if (current) setRuns(result);
    }).catch((error: Error) => {
      if (current) setListError(error.message);
    });
    return () => { current = false; };
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    let current = true;
    const load = async () => {
      try {
        const run = await api.transcodeAutomation(selectedId);
        if (!current) return;
        setDetail({ id: selectedId, run });
        if (run.status === "queued" || run.status === "running" || run.queued > run.completed + run.failed + run.canceled) {
          timer = window.setTimeout(() => void load(), 2000);
        }
      } catch (error) {
        if (current) setDetail({ id: selectedId, error: (error as Error).message });
      }
    };
    let timer: number | undefined;
    void load();
    return () => { current = false; window.clearTimeout(timer); };
  }, [selectedId]);

  const run = detail?.id === selectedId ? detail.run : undefined;
  const error = detail?.id === selectedId ? detail.error : undefined;
  const entries = run && !runs?.some((item) => item.id === run.id) ? [run, ...(runs ?? [])] : runs ?? [];
  const date = (value: string) => new Date(value).toLocaleString(i18n.language);
  const status = (entry: TranscodeAutomationRun) =>
    entry.trigger === "dry_run" ? t(key + "dryRun") : t(key + "inventory." + entry.status);

  const selectedDetails = <div className="transcode-condition-group">
      {error ? <p className="alert" role="alert">{error}</p> : !run ? <p role="status">{t("panel.loading")}</p> : <>
        <strong>{t(key + "previewResult", { total: run.files_total })}</strong>
        <p className="field-hint">{t(key + "previewCounts", run)}</p>
        {run.trigger !== "dry_run" && <p className="field-hint">{status(run)} · {t(key + "runCounts", run)}</p>}
        {run.error && <p className="alert" role="alert">{run.error}</p>}
        {run.summary.preview_items && <>
          {run.matched + run.blocked + run.skipped > run.summary.preview_items.length &&
            <p className="field-hint">{t(key + "previewSample", { count: run.summary.preview_items.length })}</p>}
          {!!run.summary.preview_items.length && <ul className="transcode-rule-layers">
            {run.summary.preview_items.map((item) => <li key={item.file_id}>
              <strong>{libraries.find((library) => library.id === item.library_id)?.name ?? item.library_id} / {item.relative_path}</strong>
              <div className="field-hint">
                {[t(key + item.status), item.rule_name, item.profile_name, item.reason || item.output_path].filter(Boolean).join(" · ")}
              </div>
            </li>)}
          </ul>}
        </>}
      </>}
    </div>;

  return <div className="compatibility-profile-list">
    {listError ? <p className="alert" role="alert">{listError}</p>
      : !runs ? <p role="status">{t("panel.loading")}</p>
        : !entries.length && !selectedId ? <p className="field-hint">{t(key + "historyEmpty")}</p> : null}
    {entries.map((entry) => <article className="compatibility-profile-list-item" key={entry.id}>
      <button type="button" className="compatibility-profile-list-trigger" aria-expanded={selectedId === entry.id}
        onClick={() => setSelection({ requested: requestedRunId, id: selectedId === entry.id ? 0 : entry.id })}>
        <strong>{status(entry)} · {date(entry.created_at)}</strong>
      </button>
      {selectedId === entry.id && selectedDetails}
    </article>)}
    {!!selectedId && !entries.some((entry) => entry.id === selectedId) && selectedDetails}
  </div>;
}
