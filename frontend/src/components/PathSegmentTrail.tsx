import { splitDisplayPath } from "../lib/path-display";

type PathSegmentTrailProps = {
  value: string;
  className?: string;
};

export function PathSegmentTrail({ value, className }: PathSegmentTrailProps) {
  const segments = splitDisplayPath(value);

  return (
    <div className={["path-segment-trail", className ?? ""].filter(Boolean).join(" ")}>
      {segments.map((segment, index) => {
        const isLastSegment = index === segments.length - 1;

        return (
          <span className="path-segment-group" key={`${segment}-${index}`}>
            {index > 0 ? (
              <span aria-hidden="true" className="path-segment-separator">
                /
              </span>
            ) : null}
            <span className={`path-segment ${isLastSegment ? "path-segment-leaf" : ""}`.trim()}>{segment}</span>
          </span>
        );
      })}
    </div>
  );
}
