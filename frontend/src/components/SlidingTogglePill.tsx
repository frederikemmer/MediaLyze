import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";

type SlidingTogglePillProps = {
  activeKey: string | null;
  className: string;
};

export function SlidingTogglePill({ activeKey, className }: SlidingTogglePillProps) {
  const pillRef = useRef<HTMLSpanElement | null>(null);
  const [style, setStyle] = useState<CSSProperties>({ visibility: "hidden" });

  useLayoutEffect(() => {
    const pill = pillRef.current;
    const container = pill?.parentElement;
    if (!pill || !container || !activeKey) {
      setStyle({ visibility: "hidden" });
      return;
    }

    const update = () => {
      const activeButton = container.querySelector<HTMLElement>(`[data-toggle-key="${activeKey}"]`);
      if (!activeButton) {
        return;
      }
      setStyle({
        width: activeButton.offsetWidth,
        height: activeButton.offsetHeight,
        transform: `translate(${activeButton.offsetLeft}px, ${activeButton.offsetTop}px)`,
        visibility: "visible",
      });
    };

    update();
    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(update);
    observer.observe(container);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [activeKey]);

  return <span ref={pillRef} className={className} style={style} aria-hidden="true" />;
}
