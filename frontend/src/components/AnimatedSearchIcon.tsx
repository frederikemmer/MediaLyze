import { motion, useAnimation } from "motion/react";
import type { HTMLAttributes, MouseEvent } from "react";
import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";

export interface AnimatedSearchIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

type AnimatedSearchIconProps = HTMLAttributes<HTMLDivElement> & {
  animateOnMount?: boolean;
  size?: number;
};

export const AnimatedSearchIcon = forwardRef<AnimatedSearchIconHandle, AnimatedSearchIconProps>(
  ({ animateOnMount = false, className, onMouseEnter, onMouseLeave, size = 22, ...props }, ref) => {
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
      (event: MouseEvent<HTMLDivElement>) => {
        onMouseEnter?.(event);
        if (!isControlledRef.current) {
          controls.start("animate");
        }
      },
      [controls, onMouseEnter],
    );

    const handleMouseLeave = useCallback(
      (event: MouseEvent<HTMLDivElement>) => {
        onMouseLeave?.(event);
        if (!isControlledRef.current) {
          controls.start("normal");
        }
      },
      [controls, onMouseLeave],
    );

    return (
      <div className={className} onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave} {...props}>
        <motion.svg
          animate={animateOnMount ? "animate" : controls}
          fill="none"
          height={size}
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          transition={{
            duration: 1,
            bounce: 0.3,
            repeat: animateOnMount ? Number.POSITIVE_INFINITY : 0,
            repeatDelay: animateOnMount ? 0.5 : 0,
            ease: "easeInOut",
          }}
          variants={{
            normal: { x: 0, y: 0 },
            animate: {
              x: [0, 0, -3, 0],
              y: [0, -4, 0, 0],
            },
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
  },
);

AnimatedSearchIcon.displayName = "AnimatedSearchIcon";
