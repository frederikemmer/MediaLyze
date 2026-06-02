import { motion, useAnimation } from "motion/react";
import type { HTMLAttributes, MouseEvent } from "react";
import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";

export type AudioLinesIconHandle = {
  startAnimation: () => void;
  stopAnimation: () => void;
};

type AudioLinesIconProps = HTMLAttributes<HTMLSpanElement> & {
  size?: number;
};

export const AudioLinesIcon = forwardRef<AudioLinesIconHandle, AudioLinesIconProps>(
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
      <span className={className} onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave} {...props}>
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
          <path d="M2 10v3" />
          <motion.path
            animate={controls}
            d="M6 6v11"
            variants={{
              normal: { d: "M6 6v11" },
              animate: {
                d: ["M6 6v11", "M6 10v3", "M6 6v11"],
                transition: { duration: 1.5, repeat: Number.POSITIVE_INFINITY },
              },
            }}
          />
          <motion.path
            animate={controls}
            d="M10 3v18"
            variants={{
              normal: { d: "M10 3v18" },
              animate: {
                d: ["M10 3v18", "M10 9v5", "M10 3v18"],
                transition: { duration: 1, repeat: Number.POSITIVE_INFINITY },
              },
            }}
          />
          <motion.path
            animate={controls}
            d="M14 8v7"
            variants={{
              normal: { d: "M14 8v7" },
              animate: {
                d: ["M14 8v7", "M14 6v11", "M14 8v7"],
                transition: { duration: 0.8, repeat: Number.POSITIVE_INFINITY },
              },
            }}
          />
          <motion.path
            animate={controls}
            d="M18 5v13"
            variants={{
              normal: { d: "M18 5v13" },
              animate: {
                d: ["M18 5v13", "M18 7v9", "M18 5v13"],
                transition: { duration: 1.5, repeat: Number.POSITIVE_INFINITY },
              },
            }}
          />
          <path d="M22 10v3" />
        </svg>
      </span>
    );
  },
);

AudioLinesIcon.displayName = "AudioLinesIcon";
