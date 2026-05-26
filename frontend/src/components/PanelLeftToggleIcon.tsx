import type { HTMLAttributes, MouseEvent } from "react";
import { useCallback } from "react";
import type { Transition, Variants } from "motion/react";
import { motion, useAnimation } from "motion/react";

type PanelLeftToggleIconProps = HTMLAttributes<HTMLDivElement> & {
  collapsed: boolean;
  size?: number;
};

const DEFAULT_TRANSITION: Transition = {
  times: [0, 0.4, 1],
  duration: 0.5,
};

const closePathVariants: Variants = {
  normal: { x: 0 },
  animate: { x: [0, -1.5, 0] },
};

const openPathVariants: Variants = {
  normal: { x: 0 },
  animate: { x: [0, 1.5, 0] },
};

export function PanelLeftToggleIcon({
  collapsed,
  onMouseEnter,
  onMouseLeave,
  size = 24,
  ...props
}: PanelLeftToggleIconProps) {
  const controls = useAnimation();

  const handleMouseEnter = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      onMouseEnter?.(event);
      void controls.start("animate");
    },
    [controls, onMouseEnter],
  );

  const handleMouseLeave = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      onMouseLeave?.(event);
      void controls.start("normal");
    },
    [controls, onMouseLeave],
  );

  return (
    <div onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave} {...props}>
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
        <rect height="18" rx="2" width="18" x="3" y="3" />
        <path d="M9 3v18" />
        <motion.path
          animate={controls}
          d={collapsed ? "m14 9 3 3-3 3" : "m16 15-3-3 3-3"}
          transition={DEFAULT_TRANSITION}
          variants={collapsed ? openPathVariants : closePathVariants}
        />
      </svg>
    </div>
  );
}
