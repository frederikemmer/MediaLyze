import { useEffect, useRef } from "react";

import { CircleDashedIcon, type CircleDashedIconHandle } from "./CircleDashedIcon";

type DuplicatePanelEmptyStateProps = {
  message: string;
};

export function DuplicatePanelEmptyState({ message }: DuplicatePanelEmptyStateProps) {
  const iconRef = useRef<CircleDashedIconHandle>(null);

  useEffect(() => {
    iconRef.current?.startAnimation();
    return () => iconRef.current?.stopAnimation();
  }, []);

  return (
    <div className="duplicate-panel-empty-state" role="status" aria-live="polite">
      <CircleDashedIcon ref={iconRef} className="duplicate-panel-empty-state-icon" size={30} aria-hidden="true" />
      <span>{message}</span>
    </div>
  );
}
