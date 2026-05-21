import { motion, useAnimation, type Variants } from "motion/react";
import type { HTMLAttributes, MouseEvent } from "react";
import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";

export type SquarePenIconHandle = {
  startAnimation: () => void;
  stopAnimation: () => void;
};

type SquarePenIconProps = HTMLAttributes<HTMLSpanElement> & {
  size?: number;
};

const PEN_VARIANTS: Variants = {
  normal: {
    rotate: 0,
    x: 0,
    y: 0,
  },
  animate: {
    rotate: [-0.5, 0.5, -0.5],
    x: [0, -1, 1.5, 0],
    y: [0, 1.5, -1, 0],
  },
};

export const SquarePenIcon = forwardRef<SquarePenIconHandle, SquarePenIconProps>(
  ({ onMouseEnter, onMouseLeave, className, size = 20, ...props }, ref) => {
    const controls = useAnimation();
    const isControlledRef = useRef(false);

    useImperativeHandle(ref, () => {
      isControlledRef.current = true;
      return {
        startAnimation: () => controls.start("animate"),
        stopAnimation: () => controls.start("normal"),
      };
    });

    const handleMouseEnter = useCallback(
      (event: MouseEvent<HTMLSpanElement>) => {
        if (isControlledRef.current) {
          onMouseEnter?.(event);
          return;
        }
        void controls.start("animate");
      },
      [controls, onMouseEnter],
    );

    const handleMouseLeave = useCallback(
      (event: MouseEvent<HTMLSpanElement>) => {
        if (isControlledRef.current) {
          onMouseLeave?.(event);
          return;
        }
        void controls.start("normal");
      },
      [controls, onMouseLeave],
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
          style={{ overflow: "visible" }}
          viewBox="0 0 24 24"
          width={size}
          xmlns="http://www.w3.org/2000/svg"
        >
          <path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
          <motion.path
            animate={controls}
            d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z"
            variants={PEN_VARIANTS}
          />
        </svg>
      </span>
    );
  },
);

SquarePenIcon.displayName = "SquarePenIcon";
