import type { Transition } from "motion/react";
import { motion, useAnimation } from "motion/react";
import type { HTMLAttributes, MouseEvent as ReactMouseEvent } from "react";
import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";

export interface ChevronsRightLeftIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface ChevronsRightLeftIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
}

const DEFAULT_TRANSITION: Transition = {
  type: "spring",
  stiffness: 250,
  damping: 25,
};

export const ChevronsRightLeftIcon = forwardRef<
  ChevronsRightLeftIconHandle,
  ChevronsRightLeftIconProps
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
        <motion.path
          animate={controls}
          d="m20 17-5-5 5-5"
          initial="normal"
          transition={DEFAULT_TRANSITION}
          variants={{
            normal: { translateX: "0%" },
            animate: { translateX: "-2px" },
          }}
        />
        <motion.path
          animate={controls}
          d="m4 17 5-5-5-5"
          initial="normal"
          transition={DEFAULT_TRANSITION}
          variants={{
            normal: { translateX: "0%" },
            animate: { translateX: "2px" },
          }}
        />
      </svg>
    </div>
  );
});

ChevronsRightLeftIcon.displayName = "ChevronsRightLeftIcon";
