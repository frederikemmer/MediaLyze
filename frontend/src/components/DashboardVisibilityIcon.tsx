import { motion, useAnimation } from "motion/react";
import { useEffect, useRef } from "react";

type DashboardVisibilityIconProps = {
  visible: boolean;
  size?: number;
};

export function DashboardVisibilityIcon({
  visible,
  size = 20,
}: DashboardVisibilityIconProps) {
  const visibleGroupControls = useAnimation();
  const hiddenGroupControls = useAnimation();
  const eyeOutlineControls = useAnimation();
  const eyeCircleControls = useAnimation();
  const slashControls = useAnimation();
  const previousVisibleRef = useRef(visible);

  useEffect(() => {
    if (previousVisibleRef.current === visible) {
      return;
    }

    if (visible) {
      void visibleGroupControls.start("visible");
      void hiddenGroupControls.start("hidden");
      void slashControls.start("hidden");
      void eyeOutlineControls.start("animate");
      void eyeCircleControls.start("animate");
    } else {
      void visibleGroupControls.start("hidden");
      void hiddenGroupControls.start("visible");
      void slashControls.start("animate");
    }

    previousVisibleRef.current = visible;
  }, [
    eyeCircleControls,
    eyeOutlineControls,
    hiddenGroupControls,
    slashControls,
    visible,
    visibleGroupControls,
  ]);

  return (
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
      <motion.g
        animate={visibleGroupControls}
        initial={visible ? "visible" : "hidden"}
        variants={{
          visible: { opacity: 1 },
          hidden: { opacity: 0 },
        }}
      >
        <motion.path
          animate={eyeOutlineControls}
          d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"
          initial="normal"
          style={{ originY: "50%" }}
          transition={{ duration: 0.4, ease: "easeInOut" }}
          variants={{
            normal: { scaleY: 1, opacity: 1 },
            animate: { scaleY: [1, 0.1, 1], opacity: [1, 0.3, 1] },
          }}
        />
        <motion.circle
          animate={eyeCircleControls}
          cx="12"
          cy="12"
          initial="normal"
          r="3"
          transition={{ duration: 0.4, ease: "easeInOut" }}
          variants={{
            normal: { scale: 1, opacity: 1 },
            animate: { scale: [1, 0.3, 1], opacity: [1, 0.3, 1] },
          }}
        />
      </motion.g>

      <motion.g
        animate={hiddenGroupControls}
        initial={visible ? "hidden" : "visible"}
        variants={{
          visible: { opacity: 1 },
          hidden: { opacity: 0 },
        }}
      >
        <path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49" />
        <path d="M14.084 14.158a3 3 0 0 1-4.242-4.242" />
        <path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143" />
        <motion.path
          animate={slashControls}
          d="m2 2 20 20"
          initial={visible ? "hidden" : "shown"}
          variants={{
            hidden: { pathLength: 0, opacity: 0, pathOffset: 0 },
            shown: { pathLength: 1, opacity: 1, pathOffset: 0 },
            animate: {
              pathLength: [0, 2],
              opacity: [0, 1],
              pathOffset: [0, 2],
              transition: { duration: 0.6 },
            },
          }}
        />
      </motion.g>
    </svg>
  );
}
