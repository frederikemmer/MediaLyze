import { motion } from "motion/react";
import type { HTMLAttributes } from "react";

type AnimatedSearchIconProps = HTMLAttributes<HTMLDivElement> & {
  size?: number;
};

export function AnimatedSearchIcon({ className, size = 22, ...props }: AnimatedSearchIconProps) {
  return (
    <div className={className} {...props}>
      <motion.svg
        animate={{
          x: [0, 0, -3, 0],
          y: [0, -4, 0, 0],
        }}
        fill="none"
        height={size}
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
        transition={{
          duration: 1,
          bounce: 0.3,
          repeat: Number.POSITIVE_INFINITY,
          repeatDelay: 0.5,
          ease: "easeInOut",
        }}
        viewBox="0 0 24 24"
        width={size}
        xmlns="http://www.w3.org/2000/svg"
      >
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.3-4.3" />
      </motion.svg>
    </div>
  );
}
