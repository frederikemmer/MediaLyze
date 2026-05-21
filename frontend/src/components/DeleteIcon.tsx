import { motion, useAnimation, type Transition, type Variants } from "motion/react";
import type { HTMLAttributes, MouseEvent } from "react";
import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";

export type DeleteIconHandle = {
  startAnimation: () => void;
  stopAnimation: () => void;
};

type DeleteIconProps = HTMLAttributes<HTMLSpanElement> & {
  size?: number;
};

const LID_VARIANTS: Variants = {
  normal: { y: 0 },
  animate: { y: -1.1 },
};

const SPRING_TRANSITION: Transition = {
  type: "spring",
  stiffness: 500,
  damping: 30,
};

export const DeleteIcon = forwardRef<DeleteIconHandle, DeleteIconProps>(
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
          viewBox="0 0 24 24"
          width={size}
          xmlns="http://www.w3.org/2000/svg"
        >
          <motion.g animate={controls} transition={SPRING_TRANSITION} variants={LID_VARIANTS}>
            <path d="M3 6h18" />
            <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
          </motion.g>
          <motion.path
            animate={controls}
            d="M19 8v12c0 1-1 2-2 2H7c-1 0-2-1-2-2V8"
            transition={SPRING_TRANSITION}
            variants={{
              normal: { d: "M19 8v12c0 1-1 2-2 2H7c-1 0-2-1-2-2V8" },
              animate: { d: "M19 9v12c0 1-1 2-2 2H7c-1 0-2-1-2-2V9" },
            }}
          />
          <motion.line
            animate={controls}
            transition={SPRING_TRANSITION}
            variants={{
              normal: { y1: 11, y2: 17 },
              animate: { y1: 11.5, y2: 17.5 },
            }}
            x1="10"
            x2="10"
            y1="11"
            y2="17"
          />
          <motion.line
            animate={controls}
            transition={SPRING_TRANSITION}
            variants={{
              normal: { y1: 11, y2: 17 },
              animate: { y1: 11.5, y2: 17.5 },
            }}
            x1="14"
            x2="14"
            y1="11"
            y2="17"
          />
        </svg>
      </span>
    );
  },
);

DeleteIcon.displayName = "DeleteIcon";
