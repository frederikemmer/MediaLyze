import { motion, useAnimation } from "motion/react";
import type { HTMLAttributes, MouseEvent as ReactMouseEvent } from "react";
import { forwardRef, useCallback, useId, useImperativeHandle, useRef } from "react";

export interface ConstructionIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface ConstructionIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
}

const ConstructionIcon = forwardRef<ConstructionIconHandle, ConstructionIconProps>(
  ({ onMouseEnter, onMouseLeave, className, size = 28, ...props }, ref) => {
    const controls = useAnimation();
    const isControlledRef = useRef(false);
    const patternId = useId();

    useImperativeHandle(ref, () => {
      isControlledRef.current = true;
      return {
        startAnimation: () => {
          void controls.start("animate");
        },
        stopAnimation: () => {
          void controls.start("normal");
        },
      };
    });

    const handleMouseEnter = useCallback(
      (event: ReactMouseEvent<HTMLDivElement>) => {
        if (isControlledRef.current) {
          onMouseEnter?.(event);
        } else {
          void controls.start("animate");
        }
      },
      [controls, onMouseEnter],
    );

    const handleMouseLeave = useCallback(
      (event: ReactMouseEvent<HTMLDivElement>) => {
        if (isControlledRef.current) {
          onMouseLeave?.(event);
        } else {
          void controls.start("normal");
        }
      },
      [controls, onMouseLeave],
    );

    return (
      <div className={className} onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave} {...props}>
        <svg
          fill="none"
          height={size}
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          viewBox="0 0 24 24"
          width={size}
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <motion.pattern
              animate={controls}
              height="14"
              id={patternId}
              initial="normal"
              patternUnits="userSpaceOnUse"
              variants={{
                normal: { x: 0 },
                animate: {
                  x: [0, 6],
                  transition: {
                    duration: 1,
                    ease: "linear",
                    repeat: Number.POSITIVE_INFINITY,
                    repeatType: "loop",
                  },
                },
              }}
              width="6"
            >
              <path d="M-4 -2 L14 30" stroke="currentColor" strokeWidth="2" />
            </motion.pattern>
          </defs>
          <rect fill={`url(#${patternId})`} height="8" rx="1" width="20" x="2" y="6" />
          <path d="M17 14v7" />
          <path d="M7 14v7" />
          <path d="M17 3v3" />
          <path d="M7 3v3" />
        </svg>
      </div>
    );
  },
);

ConstructionIcon.displayName = "ConstructionIcon";

export { ConstructionIcon };
