import type { Transition, Variants } from "motion/react";
import { motion } from "motion/react";
import type { HTMLAttributes } from "react";

const G_VARIANTS: Variants = {
  normal: { rotate: 0 },
  animate: {
    rotate: 360,
    transition: {
      repeat: Number.POSITIVE_INFINITY,
      duration: 0.8,
      ease: "linear",
    },
  },
};

const DEFAULT_TRANSITION: Transition = {
  type: "spring",
  stiffness: 50,
  damping: 10,
};

type LoaderCircleIconProps = HTMLAttributes<HTMLDivElement> & {
  size?: number;
};

export function LoaderCircleIcon({ className, size = 28, ...props }: LoaderCircleIconProps) {
  return (
    <div className={className} {...props}>
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
          animate="animate"
          d="M21 12a9 9 0 1 1-6.219-8.56"
          initial="normal"
          style={{ transformOrigin: "12px 12px" }}
          transition={DEFAULT_TRANSITION}
          variants={G_VARIANTS}
        />
      </svg>
    </div>
  );
}
