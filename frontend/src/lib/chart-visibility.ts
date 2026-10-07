import { useEffect, useState } from "react";

/** Mount costly chart renderers shortly before their existing panel enters view. */
export function useChartVisibility() {
  const [element, ref] = useState<HTMLDivElement | null>(null);
  const [ready, setReady] = useState(() => typeof IntersectionObserver === "undefined");
  useEffect(() => {
    if (ready || !element) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setReady(true);
        observer.disconnect();
      }
    }, { rootMargin: "300px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ready, element]);
  return { ref, ready };
}
