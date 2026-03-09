import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { api, type ScanJob } from "./api";

type ScanJobsContextValue = {
  activeJobs: ScanJob[];
  hasActiveJobs: boolean;
  refresh: () => Promise<void>;
  stopAll: () => Promise<void>;
};

const ScanJobsContext = createContext<ScanJobsContextValue | null>(null);

export function ScanJobsProvider({ children }: { children: ReactNode }) {
  const [activeJobs, setActiveJobs] = useState<ScanJob[]>([]);

  async function refresh() {
    try {
      const jobs = await api.activeScanJobs();
      setActiveJobs(jobs);
    } catch {
      // Keep the last known active jobs on transient polling errors.
    }
  }

  async function stopAll() {
    try {
      await api.cancelActiveScanJobs();
      setActiveJobs([]);
    } catch {
      // Keep the last known state on transient errors.
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const jobs = await api.activeScanJobs();
        if (!cancelled) {
          setActiveJobs(jobs);
        }
      } catch {
        // Keep the last known state on transient errors.
      }
    }

    void load();
    const timer = window.setInterval(() => {
      void load();
    }, 3000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const value = useMemo(
    () => ({
      activeJobs,
      hasActiveJobs: activeJobs.length > 0,
      refresh,
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
