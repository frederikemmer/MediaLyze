import "@testing-library/jest-dom/vitest";
import React from "react";
import { vi } from "vitest";

vi.mock("echarts-for-react", () => ({
  default: ({
    option,
    onEvents,
  }: {
    option?: { series?: Array<{ data?: unknown[] }> };
    onEvents?: { click?: (params: { dataIndex: number }) => void };
  }) =>
    React.createElement("div", {
      "data-testid": "echarts-react",
      "data-points": JSON.stringify(option?.series?.[0]?.data ?? []),
      "data-clickable": String(Boolean(onEvents?.click)),
      onClick: () => onEvents?.click?.({ dataIndex: 0 }),
    }),
}));
