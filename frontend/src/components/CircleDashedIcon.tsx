import { motion, useAnimation, type Variants } from "motion/react";
import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useRef,
  type HTMLAttributes,
  type MouseEvent,
} from "react";

export interface CircleDashedIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

type CircleDashedIconProps = HTMLAttributes<HTMLDivElement> & {
  size?: number;
};

const pathVariants: Variants = {
  normal: { opacity: 0.36 },
  animate: (index: number) => ({
    opacity: [0.2, 1, 0.2],
    transition: {
      delay: index * 0.08,
      duration: 0.9,
      ease: "easeInOut",
      repeat: Number.POSITIVE_INFINITY,
      repeatType: "loop",
    },
  }),
};

export const CircleDashedIcon = forwardRef<CircleDashedIconHandle, CircleDashedIconProps>(
  ({ onMouseEnter, onMouseLeave, className, size = 28, ...props }, ref) => {
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
      (event: MouseEvent<HTMLDivElement>) => {
        if (isControlledRef.current) {
          onMouseEnter?.(event);
        } else {
          void controls.start("animate");
        }
      },
      [controls, onMouseEnter],
    );

    const handleMouseLeave = useCallback(
      (event: MouseEvent<HTMLDivElement>) => {
        if (isControlledRef.current) {
          onMouseLeave?.(event);
        } else {
          void controls.start("normal");
        }
      },
      [controls, onMouseLeave],
    );

    return (
      <div className={className} onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave} {...props}>
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
          {[
            "M10.1 2.182a10 10 0 0 1 3.8 0",
            "M13.9 21.818a10 10 0 0 1-3.8 0",
            "M17.609 3.721a10 10 0 0 1 2.69 2.7",
            "M2.182 13.9a10 10 0 0 1 0-3.8",
            "M20.279 17.609a10 10 0 0 1-2.7 2.69",
            "M21.818 10.1a10 10 0 0 1 0 3.8",
            "M3.721 6.391a10 10 0 0 1 2.7-2.69",
            "M6.391 20.279a10 10 0 0 1-2.69-2.7",
          ].map((path, index) => (
            <motion.path
              key={path}
              animate={controls}
              custom={index + 1}
              d={path}
              initial="normal"
              variants={pathVariants}
            />
          ))}
        </svg>
      </div>
    );
  },
);

CircleDashedIcon.displayName = "CircleDashedIcon";
