import { createContext, useContext, useEffect, useEffectEvent, useMemo, useRef, useState, type ReactNode } from "react";

import { api, type ScanJob } from "./api";
import { usePageVisibility } from "./page-visibility";

type ScanJobsContextValue = {
  activeJobs: ScanJob[];
  hasActiveJobs: boolean;
  refresh: () => Promise<void>;
  trackJob: (job: ScanJob) => void;
  stopAll: () => Promise<void>;
};

const ScanJobsContext = createContext<ScanJobsContextValue | null>(null);
export const ACTIVE_SCAN_JOBS_POLL_INTERVAL_MS = 5000;
export const ACTIVE_DUPLICATE_PHASE_POLL_INTERVAL_MS = 750;
export const ACTIVE_SCAN_PROGRESS_POLL_INTERVAL_MS = 1000;

export function ScanJobsProvider({ children }: { children: ReactNode }) {
  const [activeJobs, setActiveJobs] = useState<ScanJob[]>([]);
  const isPageVisible = usePageVisibility();
  const wasPageVisibleRef = useRef(isPageVisible);
  const initializedRef = useRef(false);
  const hasDuplicatePhaseJob = activeJobs.some((job) =>
    [
      "detecting_duplicates_preparing",
      "detecting_duplicates_artifacts",
      "detecting_duplicates_grouping",
    ].includes(job.phase_key),
  );
  const pollInterval = isPageVisible && activeJobs.length > 0
    ? (hasDuplicatePhaseJob ? ACTIVE_DUPLICATE_PHASE_POLL_INTERVAL_MS : ACTIVE_SCAN_PROGRESS_POLL_INTERVAL_MS)
    : null;

  const refresh = useEffectEvent(async () => {
    try {
      const jobs = await api.activeScanJobs();
      setActiveJobs(jobs);
    } catch {
      // Keep the last known active jobs on transient polling errors.
    }
  });

  const stopAll = useEffectEvent(async () => {
    try {
      await api.cancelActiveScanJobs();
      setActiveJobs([]);
    } catch {
      // Keep the last known state on transient errors.
    }
  });

  const trackJob = useEffectEvent((job: ScanJob) => {
    setActiveJobs((current) => {
      const existing = current.find((entry) => entry.library_id === job.library_id);
      if (
        existing &&
        existing.status === "running" &&
        job.status === "queued"
      ) {
        return current;
      }
      const next = current.filter((entry) => entry.library_id !== job.library_id);
      return [...next, job];
    });
  });

  useEffect(() => {
    if (!isPageVisible || initializedRef.current) {
      return;
    }
    initializedRef.current = true;
    void refresh();
  }, [isPageVisible, refresh]);

  useEffect(() => {
    if (typeof window === "undefined" || activeJobs.length === 0) {
      return undefined;
    }

    function handleWindowFocus() {
      if (document.visibilityState === "hidden") {
        return;
      }
      void refresh();
    }

    window.addEventListener("focus", handleWindowFocus);
    return () => {
      window.removeEventListener("focus", handleWindowFocus);
    };
  }, [activeJobs.length, refresh]);

  useEffect(() => {
    if (activeJobs.length > 0 && isPageVisible && !wasPageVisibleRef.current) {
      void refresh();
    }
    wasPageVisibleRef.current = isPageVisible;
  }, [activeJobs.length, isPageVisible, refresh]);

  useEffect(() => {
    if (pollInterval === null) {
      return undefined;
    }

    const timer = window.setInterval(() => {
      void refresh();
    }, pollInterval);

    return () => {
      window.clearInterval(timer);
    };
  }, [pollInterval, refresh]);

  const value = useMemo(
    () => ({
      activeJobs,
      hasActiveJobs: activeJobs.length > 0,
      refresh,
      trackJob,
      stopAll,
    }),
    [activeJobs],
  );

  return <ScanJobsContext.Provider value={value}>{children}</ScanJobsContext.Provider>;
}

export function useScanJobs() {
  const context = useContext(ScanJobsContext);
  if (!context) {
    throw new Error("useScanJobs must be used inside ScanJobsProvider");
  }
  return context;
}
