import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";

type SlidingTogglePillProps = {
  activeKey: string | null;
  className: string;
};

export function SlidingTogglePill({ activeKey, className }: SlidingTogglePillProps) {
  const pillRef = useRef<HTMLSpanElement | null>(null);
  const [style, setStyle] = useState<CSSProperties | undefined>(undefined);

  useLayoutEffect(() => {
    const pill = pillRef.current;
    const container = pill?.parentElement;
    if (!pill || !container || !activeKey) {
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
      });
    };

    update();
    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(update);
    observer.observe(container);
    return () => observer.disconnect();
  }, [activeKey]);

  return <span ref={pillRef} className={className} style={style} aria-hidden="true" />;
}
