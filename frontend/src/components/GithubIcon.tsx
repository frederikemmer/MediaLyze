import type { Variants } from "motion/react";
import { motion, useAnimation } from "motion/react";
import type { HTMLAttributes, MouseEvent as ReactMouseEvent } from "react";
import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";

export interface GithubIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface GithubIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
}

const BODY_VARIANTS: Variants = {
  normal: {
    opacity: 1,
    pathLength: 1,
    scale: 1,
    transition: {
      duration: 0.3,
    },
  },
  animate: {
    opacity: [0, 1],
    pathLength: [0, 1],
    scale: [0.9, 1],
    transition: {
      duration: 0.4,
    },
  },
};

const TAIL_VARIANTS: Variants = {
  normal: {
    pathLength: 1,
    rotate: 0,
    transition: {
      duration: 0.3,
    },
  },
  draw: {
    pathLength: [0, 1],
    rotate: 0,
    transition: {
      duration: 0.5,
    },
  },
  wag: {
    pathLength: 1,
    rotate: [0, -15, 15, -10, 10, -5, 5],
    transition: {
      duration: 2.5,
      ease: "easeInOut",
      repeat: Number.POSITIVE_INFINITY,
    },
  },
};

export const GithubIcon = forwardRef<GithubIconHandle, GithubIconProps>(
  ({ onMouseEnter, onMouseLeave, className, size = 28, ...props }, ref) => {
    const bodyControls = useAnimation();
    const tailControls = useAnimation();
    const isControlledRef = useRef(false);

    useImperativeHandle(ref, () => {
      isControlledRef.current = true;
      return {
        startAnimation: async () => {
          void bodyControls.start("animate");
          await tailControls.start("draw");
          void tailControls.start("wag");
        },
        stopAnimation: () => {
          void bodyControls.start("normal");
          void tailControls.start("normal");
        },
      };
    });

    const handleMouseEnter = useCallback(
      async (event: ReactMouseEvent<HTMLDivElement>) => {
        if (isControlledRef.current) {
          onMouseEnter?.(event);
          return;
        }
        void bodyControls.start("animate");
        await tailControls.start("draw");
        void tailControls.start("wag");
      },
      [bodyControls, onMouseEnter, tailControls],
    );

    const handleMouseLeave = useCallback(
      (event: ReactMouseEvent<HTMLDivElement>) => {
        if (isControlledRef.current) {
          onMouseLeave?.(event);
          return;
        }
        void bodyControls.start("normal");
        void tailControls.start("normal");
      },
      [bodyControls, onMouseLeave, tailControls],
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
          <motion.path
            animate={bodyControls}
            d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4"
            initial="normal"
            variants={BODY_VARIANTS}
          />
          <motion.path
            animate={tailControls}
            d="M9 18c-4.51 2-5-2-7-2"
            initial="normal"
            variants={TAIL_VARIANTS}
          />
        </svg>
      </div>
    );
  },
);

GithubIcon.displayName = "GithubIcon";
