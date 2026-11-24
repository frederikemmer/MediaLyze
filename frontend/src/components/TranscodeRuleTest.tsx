import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, type ResolutionCategory, type TranscodeRuleTestAsset, type TranscodeRuleTestRequest, type TranscodeRuleTestResult } from "../lib/api";
import { RuleConditionTrace, RuleInput, validRuleConditions } from "./TranscodeRuleConditions";

const key = "transcoding.automation.";

export function TranscodeRuleTest({ draft, presetName, resolutionCategories }: {
  draft: Omit<TranscodeRuleTestRequest, "file_id">;
  presetName?: string;
  resolutionCategories?: ResolutionCategory[];
}) {
  const { t } = useTranslation();
  const optionsId = useId();
  const picker = useRef<HTMLDivElement>(null);
  const [asset, setAsset] = useState<TranscodeRuleTestAsset | null>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const search = query.trim();
  const [searchResult, setSearchResult] = useState<{ query: string; assets: TranscodeRuleTestAsset[]; failed?: boolean }>();
  const currentSearch = searchResult?.query === search ? searchResult : undefined;
  const assets = currentSearch?.assets ?? [];
  const [test, setTest] = useState<{ request: string; result?: TranscodeRuleTestResult; error?: string }>();
  const canTest = draft.library_ids.length > 0 && draft.profile_id > 0 && validRuleConditions(draft.conditions);
  const request = asset && canTest ? JSON.stringify({ ...draft, file_id: asset.id }) : "";
  const currentTest = test?.request === request ? test : undefined;
  const result = currentTest?.result;

  useEffect(() => {
    if (!open) return;
    const handleOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !picker.current?.contains(event.target)) {
        setOpen(false);
        setQuery(asset?.title || asset?.filename || "");
      }
    };
    document.addEventListener("pointerdown", handleOutside);
    return () => document.removeEventListener("pointerdown", handleOutside);
  }, [open, asset]);

  useEffect(() => {
    if (!open || !search) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      api.searchTranscodeRuleAssets(search, controller.signal).then(files => {
        if (!controller.signal.aborted) setSearchResult({ query: search, assets: files });
      }).catch(() => {
        if (!controller.signal.aborted) setSearchResult({ query: search, assets: [], failed: true });
      });
    }, 180);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [open, search]);

  useEffect(() => {
    if (!request) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      api.testTranscodeRule(JSON.parse(request) as TranscodeRuleTestRequest, controller.signal).then(next => {
        if (!controller.signal.aborted) setTest({ request, result: next });
      }).catch((error: Error) => {
        if (!controller.signal.aborted) setTest({ request, error: error.message });
      });
    }, 180);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [request]);

  function close() {
    setOpen(false);
    setQuery(asset?.title || asset?.filename || "");
  }

  function choose(file: TranscodeRuleTestAsset) {
    setAsset(file);
    setQuery(file.title || file.filename);
    setOpen(false);
    picker.current?.querySelector("input")?.focus();
  }

  let status = "";
  if (result) {
    if (!result.in_scope) status = t(key + "outsideLibraries");
    else if (result.status === "unmatched") status = t(key + "conditionsNotMet");
    else if (result.status === "blocked" || result.status === "skipped") status = result.reason || t(key + "testBlocked");
    else status = [presetName, t(key + (result.output_path ? "outputInto" : "testMatched"))].filter(Boolean).join(" · ");
  }

  return <section className="transcode-rule-test">
    <div className="transcode-rule-test-picker">
      <h4>{t(key + "testRule")}</h4>
      <div className="transcode-rule-test-search" ref={picker} onBlur={event => {
        if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) close();
      }} onKeyDown={event => {
        const input = picker.current?.querySelector("input");
        if (event.nativeEvent.isComposing) return;
        if (event.key === "Escape" && open) { event.preventDefault(); close(); input?.focus(); return; }
        const choices = [...(picker.current?.querySelectorAll("button") ?? [])];
        if (!open || !choices.length) return;
        const index = choices.indexOf(event.target as HTMLButtonElement);
        if (event.key === "Enter" && event.target === input) { event.preventDefault(); choices[0].click(); }
        if (event.key === "ArrowDown" || (event.key === "ArrowUp" && index >= 0)) {
          event.preventDefault();
          (choices[event.key === "ArrowDown" ? Math.min(index + 1, choices.length - 1) : index - 1] ?? input)?.focus();
        }
      }}>
        <RuleInput label={t(key + "testFileSearch")} value={query} maxLength={512} autoComplete="off"
          aria-controls={open && search ? optionsId : undefined} placeholder={t(key + "titleOrFilename")}
          onChange={event => { setQuery(event.target.value); setOpen(true); }} />
        {open && search && <ul id={optionsId} className="compatibility-profile-list transcode-rule-test-options" aria-label={t(key + "testFileSearch")}>
          {assets.map(file => <li key={file.id} className="compatibility-profile-list-item">
            <button type="button" className="compatibility-profile-list-trigger" onClick={() => choose(file)}
              aria-label={file.title && file.title !== file.filename ? `${file.title} · ${file.filename}` : file.filename}>
              <span className="transcode-automation-list-copy"><strong>{file.title || file.filename}</strong>
                {file.title && file.title !== file.filename && <small>{file.filename}</small>}</span>
            </button>
          </li>)}
          {!assets.length && <li className="field-hint" role="status">{t(key + (!currentSearch ? "searchingFiles" : currentSearch.failed ? "testSearchFailed" : "noTestFiles"))}</li>}
        </ul>}
      </div>
    </div>
    {asset && <div className="transcode-condition-group transcode-rule-test-result" aria-live="polite">
      {result ? <>
        <ul className="transcode-rule-layers"><RuleConditionTrace node={draft.conditions} trace={result.trace} resolutionCategories={resolutionCategories} /></ul>
        <p><strong className={result.status === "matched" ? "transcode-rule-test-success" : undefined}>{status}</strong>
          {result.status === "matched" && result.output_path && <> <span className="jellyfin-status-badge" title={result.output_path}>
            {draft.output_mode === "transcode_output" && result.output_relative_path ? `Transcode_Output/${result.output_relative_path}` : result.output_relative_path || result.output_path}
          </span></>}
        </p>
      </> : <p className="field-hint">{currentTest?.error || t(key + (canTest ? "testingRule" : "completeRule"))}</p>}
    </div>}
  </section>;
}
