import { motion, useAnimation } from "motion/react";
import type { HTMLAttributes, MouseEvent as ReactMouseEvent } from "react";
import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";

export interface GitCompareArrowsIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface GitCompareArrowsIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
}

const DURATION = 0.3;

function calculateDelay(index: number): number {
  if (index === 0) {
    return 0.1;
  }
  return index * DURATION + 0.1;
}

export const GitCompareArrowsIcon = forwardRef<
  GitCompareArrowsIconHandle,
  GitCompareArrowsIconProps
>(({ onMouseEnter, onMouseLeave, className, size = 28, ...props }, ref) => {
  const controls = useAnimation();
  const isControlledRef = useRef(false);

  useImperativeHandle(ref, () => {
    isControlledRef.current = true;
    return {
      startAnimation: () => void controls.start("animate"),
      stopAnimation: () => void controls.start("normal"),
    };
  });

  const handleMouseEnter = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (isControlledRef.current) {
        onMouseEnter?.(event);
        return;
      }
      void controls.start("animate");
    },
    [controls, onMouseEnter],
  );

  const handleMouseLeave = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (isControlledRef.current) {
        onMouseLeave?.(event);
        return;
      }
      void controls.start("normal");
    },
    [controls, onMouseLeave],
  );

  return (
    <div
      className={className}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      {...props}
    >
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
        <motion.circle
          animate={controls}
          cx="5"
          cy="6"
          r="3"
          transition={{
            duration: DURATION,
            delay: calculateDelay(0),
            opacity: { delay: calculateDelay(0) },
          }}
          variants={{
            normal: { pathLength: 1, opacity: 1, transition: { delay: 0 } },
            animate: {
              pathLength: [0, 1],
              opacity: [0, 1],
            },
          }}
        />

        <motion.path
          animate={controls}
          d="M12 6h5a2 2 0 0 1 2 2v7"
          transition={{
            duration: DURATION,
            delay: calculateDelay(1),
            opacity: { delay: calculateDelay(1) },
          }}
          variants={{
            normal: {
              pathLength: 1,
              pathOffset: 0,
              opacity: 1,
              transition: { delay: 0 },
            },
            animate: {
              pathLength: [0, 1],
              opacity: [0, 1],
              pathOffset: [1, 0],
            },
          }}
        />

        <motion.path
          animate={controls}
          d="m15 9-3-3 3-3"
          transition={{
            duration: DURATION,
            delay: calculateDelay(1),
            opacity: { delay: calculateDelay(1) },
          }}
          variants={{
            normal: { opacity: 1 },
            animate: { opacity: [0, 1] },
          }}
        />

        <motion.circle
          animate={controls}
          cx="19"
          cy="18"
          r="3"
          transition={{
            duration: DURATION,
            delay: calculateDelay(2),
            opacity: { delay: calculateDelay(2) },
          }}
          variants={{
            normal: { pathLength: 1, opacity: 1, transition: { delay: 0 } },
            animate: {
              pathLength: [0, 1],
              opacity: [0, 1],
            },
          }}
        />

        <motion.path
          animate={controls}
          d="M12 18H7a2 2 0 0 1-2-2V9"
          transition={{
            duration: DURATION,
            delay: calculateDelay(1),
            opacity: { delay: calculateDelay(1) },
          }}
          variants={{
            normal: {
              pathLength: 1,
              pathOffset: 0,
              opacity: 1,
              transition: { delay: 0 },
            },
            animate: {
              pathLength: [0, 1],
              opacity: [0, 1],
              pathOffset: [1, 0],
            },
          }}
        />

        <motion.path
          animate={controls}
          d="m9 15 3 3-3 3"
          transition={{
            duration: DURATION,
            delay: calculateDelay(1),
            opacity: { delay: calculateDelay(1) },
          }}
          variants={{
            normal: { opacity: 1 },
            animate: { opacity: [0, 1] },
          }}
        />
      </svg>
    </div>
  );
});

GitCompareArrowsIcon.displayName = "GitCompareArrowsIcon";
