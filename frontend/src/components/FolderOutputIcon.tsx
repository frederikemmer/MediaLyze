import { motion } from "motion/react";
import { useState, type HTMLAttributes } from "react";

type FolderOutputIconProps = HTMLAttributes<HTMLDivElement> & {
  size?: number;
};

const arrowVariants = {
  normal: { x: 0 },
  animate: { x: [0, -2, 0] },
};

const arrowTransition = {
  times: [0, 0.4, 1],
  duration: 0.5,
};

export function FolderOutputIcon({ className, size = 28, ...props }: FolderOutputIconProps) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      className={className}
      onBlur={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
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
        <path d="M2 7.5V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-1.5" />
        <motion.g
          animate={hovered ? "animate" : "normal"}
          initial="normal"
          transition={arrowTransition}
          variants={arrowVariants}
        >
          <path d="M2 13h10" />
          <path d="m5 10-3 3 3 3" />
        </motion.g>
      </svg>
    </div>
  );
}
