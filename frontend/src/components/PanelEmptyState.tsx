import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import { ConstructionIcon, type ConstructionIconHandle } from "./ConstructionIcon";

type PanelEmptyStateProps = {
  message?: string;
};

export function PanelEmptyState({ message }: PanelEmptyStateProps) {
  const { t } = useTranslation();
  const iconRef = useRef<ConstructionIconHandle>(null);

  useEffect(() => {
    iconRef.current?.startAnimation();
    return () => iconRef.current?.stopAnimation();
  }, []);

  return (
    <div className="panel-empty-state">
      <ConstructionIcon ref={iconRef} className="panel-empty-state-icon" size={30} aria-hidden="true" />
      <span>{message ?? t("panel.noDataYet")}</span>
    </div>
  );
}
