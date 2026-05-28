import type { CSSProperties, MouseEventHandler, ReactNode } from "react";
import {
  useEffect,
  useEffectEvent,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

type TooltipAlign = "center" | "start";

type TooltipTriggerProps = {
  content: ReactNode;
  ariaLabel: string;
  align?: TooltipAlign;
  className?: string;
  tooltipClassName?: string;
  maxWidth?: number;
  preserveLineBreaks?: boolean;
  onOpen?: () => void;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  disabled?: boolean;
  pinOnClick?: boolean;
  children?: ReactNode;
};

const TOOLTIP_GAP = 10;
const TOOLTIP_VIEWPORT_MARGIN = 16;
const TOOLTIP_MAX_WIDTH = 320;
const TOOLTIP_OPEN_EVENT = "medialyze-tooltip-open";
const TOOLTIP_HOVER_OPEN_DELAY = 350;

export function TooltipTrigger({
  content,
  ariaLabel,
  align = "center",
  className,
  tooltipClassName,
  maxWidth = TOOLTIP_MAX_WIDTH,
  preserveLineBreaks = false,
  onOpen,
  onClick,
  disabled = false,
  pinOnClick = true,
  children = "?",
}: TooltipTriggerProps) {
  const tooltipId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const openTimerRef = useRef<number | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const [isHovered, setIsHovered] = useState(false);
  const [isTooltipHovered, setIsTooltipHovered] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [isPinned, setIsPinned] = useState(false);
  const [tooltipStyle, setTooltipStyle] = useState<CSSProperties | null>(null);

  const isOpen = isHovered || isTooltipHovered || isFocused || isPinned;

  const clearOpenTimer = useEffectEvent(() => {
    if (openTimerRef.current === null) {
      return;
    }
    window.clearTimeout(openTimerRef.current);
    openTimerRef.current = null;
  });

  const clearCloseTimer = useEffectEvent(() => {
    if (closeTimerRef.current === null) {
      return;
    }
    window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  });

  const scheduleHoverClose = useEffectEvent(() => {
    clearOpenTimer();
    clearCloseTimer();
    closeTimerRef.current = window.setTimeout(() => {
      setIsHovered(false);
      setIsTooltipHovered(false);
      closeTimerRef.current = null;
    }, 120);
  });

  const scheduleHoverOpen = useEffectEvent(() => {
    clearCloseTimer();
    clearOpenTimer();
    openTimerRef.current = window.setTimeout(() => {
      setIsHovered(true);
      openTimerRef.current = null;
    }, TOOLTIP_HOVER_OPEN_DELAY);
  });

  const updatePosition = useEffectEvent(() => {
    const trigger = triggerRef.current;
    const tooltip = tooltipRef.current;
    if (!trigger || !tooltip) {
      return;
    }

    const triggerRect = trigger.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const availableWidth = Math.max(0, viewportWidth - TOOLTIP_VIEWPORT_MARGIN * 2);
    const resolvedWidth = Math.min(maxWidth, availableWidth);
    const tooltipWidth = Math.min(tooltip.offsetWidth || resolvedWidth, resolvedWidth);
    const idealLeft =
      align === "center"
        ? triggerRect.left + triggerRect.width / 2 - tooltipWidth / 2
        : triggerRect.left;
    const left = Math.min(
      Math.max(TOOLTIP_VIEWPORT_MARGIN, idealLeft),
      Math.max(TOOLTIP_VIEWPORT_MARGIN, viewportWidth - TOOLTIP_VIEWPORT_MARGIN - tooltipWidth),
    );
    const top = triggerRect.bottom + TOOLTIP_GAP;
    const maxHeight = Math.max(64, viewportHeight - top - TOOLTIP_VIEWPORT_MARGIN);

    setTooltipStyle((current) => {
      if (
        current?.left === left &&
        current.top === top &&
        current.width === resolvedWidth &&
        current.maxHeight === maxHeight &&
        current.visibility === "visible"
      ) {
        return current;
      }
      return {
        left,
        top,
        width: resolvedWidth,
        maxHeight,
        visibility: "visible",
      };
    });
  });

  useLayoutEffect(() => {
    if (!isOpen) {
      if (tooltipStyle !== null) {
        setTooltipStyle(null);
      }
      return;
    }
    updatePosition();
  }, [align, isOpen, preserveLineBreaks, tooltipStyle, updatePosition]);

  useLayoutEffect(() => {
    if (!isOpen) {
      return;
    }
    updatePosition();
  }, [content, isOpen, updatePosition]);

  const closeTooltip = useEffectEvent(() => {
    clearOpenTimer();
    clearCloseTimer();
    setIsHovered(false);
    setIsTooltipHovered(false);
    setIsFocused(false);
    setIsPinned(false);
  });

  useEffect(() => () => {
    clearOpenTimer();
    clearCloseTimer();
  }, [clearCloseTimer, clearOpenTimer]);

  useEffect(() => {
    const handleTooltipOpen = (event: Event) => {
      const detail = (event as CustomEvent<{ id?: string }>).detail;
      if (!detail?.id || detail.id === tooltipId) {
        return;
      }
      closeTooltip();
    };

    window.addEventListener(TOOLTIP_OPEN_EVENT, handleTooltipOpen as EventListener);
    return () => window.removeEventListener(TOOLTIP_OPEN_EVENT, handleTooltipOpen as EventListener);
  }, [closeTooltip, tooltipId]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    window.dispatchEvent(new CustomEvent(TOOLTIP_OPEN_EVENT, { detail: { id: tooltipId } }));
    onOpen?.();
  }, [isOpen, onOpen, tooltipId]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleResize = () => updatePosition();
    const handleScrollLikeInteraction = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        closeTooltip();
        return;
      }

      const trigger = triggerRef.current;
      const tooltip = tooltipRef.current;
      if (trigger?.contains(target) || tooltip?.contains(target)) {
        return;
      }

      closeTooltip();
    };

    window.addEventListener("resize", handleResize);
    document.addEventListener("scroll", handleScrollLikeInteraction, true);
    document.addEventListener("wheel", handleScrollLikeInteraction, { capture: true, passive: true });
    document.addEventListener("touchmove", handleScrollLikeInteraction, { capture: true, passive: true });

    return () => {
      window.removeEventListener("resize", handleResize);
      document.removeEventListener("scroll", handleScrollLikeInteraction, true);
      document.removeEventListener("wheel", handleScrollLikeInteraction, true);
      document.removeEventListener("touchmove", handleScrollLikeInteraction, true);
    };
  }, [closeTooltip, isOpen, updatePosition]);

  useEffect(() => {
    if (!isPinned) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const trigger = triggerRef.current;
      const tooltip = tooltipRef.current;
      if (trigger?.contains(event.target as Node) || tooltip?.contains(event.target as Node)) {
        return;
      }
      closeTooltip();
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [isPinned, closeTooltip]);

  const handleClick: MouseEventHandler<HTMLButtonElement> = (event) => {
    onClick?.(event);
    if (event.defaultPrevented || !pinOnClick) {
      return;
    }
    if (isPinned) {
      closeTooltip();
      triggerRef.current?.blur();
      return;
    }
    setIsPinned(true);
    triggerRef.current?.focus();
  };

  const tooltipPortalClassName = [
    "tooltip-portal",
    preserveLineBreaks ? "tooltip-portal-preline" : "",
    tooltipClassName ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={ariaLabel}
        aria-describedby={isOpen ? tooltipId : undefined}
        aria-expanded={isOpen}
        disabled={disabled}
        className={["tooltip-trigger", className ?? ""].filter(Boolean).join(" ")}
        onMouseEnter={() => {
          scheduleHoverOpen();
        }}
        onMouseLeave={() => scheduleHoverClose()}
        onFocus={() => {
          clearOpenTimer();
          clearCloseTimer();
          setIsFocused(true);
        }}
        onBlur={() => {
          clearOpenTimer();
          setIsFocused(false);
          setIsPinned(false);
        }}
        onClick={handleClick}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            closeTooltip();
            triggerRef.current?.blur();
          }
        }}
      >
        {children}
      </button>
      {isOpen && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={tooltipRef}
              id={tooltipId}
              role="tooltip"
              className={tooltipPortalClassName}
              style={tooltipStyle ?? { left: TOOLTIP_VIEWPORT_MARGIN, top: 0, visibility: "hidden" }}
              onMouseEnter={() => {
                clearCloseTimer();
                setIsTooltipHovered(true);
              }}
              onMouseLeave={() => scheduleHoverClose()}
            >
              {content}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
