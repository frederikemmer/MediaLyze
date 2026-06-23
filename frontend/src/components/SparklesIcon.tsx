import { motion, useAnimation, type Variants } from "motion/react";
import type { HTMLAttributes, MouseEvent } from "react";
import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";

export type SparklesIconHandle = {
  startAnimation: () => void;
  stopAnimation: () => void;
};

type SparklesIconProps = HTMLAttributes<HTMLSpanElement> & {
  size?: number;
};

const SPARKLE_VARIANTS: Variants = {
  initial: {
    y: 0,
    fill: "none",
  },
  hover: {
    y: [0, -1, 0, 0],
    fill: "currentColor",
    transition: {
      duration: 1,
      bounce: 0.3,
    },
  },
};

const STAR_VARIANTS: Variants = {
  initial: {
    opacity: 1,
    x: 0,
    y: 0,
  },
  blink: {
    opacity: [0, 1, 0, 0, 0, 0, 1],
    transition: {
      duration: 2,
      type: "spring",
      stiffness: 70,
      damping: 10,
      mass: 0.4,
    },
  },
};

export const SparklesIcon = forwardRef<SparklesIconHandle, SparklesIconProps>(
  ({ onMouseEnter, onMouseLeave, className, size = 20, ...props }, ref) => {
    const starControls = useAnimation();
    const sparkleControls = useAnimation();
    const isControlledRef = useRef(false);

    useImperativeHandle(ref, () => {
      isControlledRef.current = true;
      return {
        startAnimation: () => {
          void sparkleControls.start("hover");
          void starControls.start("blink", { delay: 1 });
        },
        stopAnimation: () => {
          void sparkleControls.start("initial");
          void starControls.start("initial");
        },
      };
    });

    const handleMouseEnter = useCallback(
      (event: MouseEvent<HTMLSpanElement>) => {
        if (isControlledRef.current) {
          onMouseEnter?.(event);
          return;
        }
        void sparkleControls.start("hover");
        void starControls.start("blink", { delay: 1 });
      },
      [onMouseEnter, sparkleControls, starControls],
    );

    const handleMouseLeave = useCallback(
      (event: MouseEvent<HTMLSpanElement>) => {
        if (isControlledRef.current) {
          onMouseLeave?.(event);
          return;
        }
        void sparkleControls.start("initial");
        void starControls.start("initial");
      },
      [onMouseLeave, sparkleControls, starControls],
    );

    return (
      <span
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
            animate={sparkleControls}
            d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"
            initial="initial"
            variants={SPARKLE_VARIANTS}
          />
          <motion.path animate={starControls} d="M20 3v4" initial="initial" variants={STAR_VARIANTS} />
          <motion.path animate={starControls} d="M22 5h-4" initial="initial" variants={STAR_VARIANTS} />
          <motion.path animate={starControls} d="M4 17v2" initial="initial" variants={STAR_VARIANTS} />
          <motion.path animate={starControls} d="M5 18H3" initial="initial" variants={STAR_VARIANTS} />
        </svg>
      </span>
    );
  },
);

SparklesIcon.displayName = "SparklesIcon";
