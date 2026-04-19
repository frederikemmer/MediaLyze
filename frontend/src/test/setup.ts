import "@testing-library/jest-dom/vitest";
import React from "react";
import { vi } from "vitest";

vi.mock("motion/react", () => {
  const motion = new Proxy(
    {},
    {
      get: (_target, element: string) =>
        React.forwardRef<HTMLElement, React.HTMLAttributes<HTMLElement> & { layoutId?: string }>(
          ({ children, layoutId: _layoutId, ...props }, ref) =>
            React.createElement(element, { ...props, ref }, children),
        ),
    },
  );

  return {
    motion,
    useAnimation: () => ({
      start: vi.fn(() => Promise.resolve()),
    }),
  };
});

vi.mock("echarts-for-react", () => ({
  default: ({
    option,
    onEvents,
    style,
  }: {
    option?: { series?: Array<{ data?: unknown[]; type?: string; areaStyle?: unknown; name?: string }> };
    onEvents?: { click?: (params: { dataIndex: number }) => void };
    style?: { cursor?: string };
  }) =>
    React.createElement(
      "div",
      {
        "data-testid": "echarts-react",
        "data-points": JSON.stringify(option?.series?.[0]?.data ?? []),
        "data-series-types": JSON.stringify(option?.series?.map((series) => series.type ?? "") ?? []),
        "data-series-count": String(option?.series?.length ?? 0),
        "data-series-has-area": JSON.stringify(option?.series?.map((series) => Boolean(series.areaStyle)) ?? []),
        "data-series-names": JSON.stringify(option?.series?.map((series) => series.name ?? "") ?? []),
        "data-clickable": String(Boolean(onEvents?.click)),
        "data-cursor": style?.cursor ?? "",
        onClick: () => onEvents?.click?.({ dataIndex: 0 }),
      },
      option?.series?.map((series) => series.name).filter(Boolean).join(" "),
    ),
}));
