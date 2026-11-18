import { useCallback, useEffect, useRef, useState } from "react";
import type { LineHover } from "@/features/map";

export interface HoverState {
  key: string;
  x: number;
  y: number;
  pinned: boolean;
}

/**
 * Popover of the hovered line: stays open while the mouse is on the line or on it (small delay to move from one to
 * the other). A click pins it; when pinned, hovering another line does not replace the popover.
 */
export function useLineHover() {
  const [hover, setHover] = useState<HoverState | null>(null);
  const closeTimer = useRef<number | undefined>(undefined);

  const cancelClose = useCallback(() => window.clearTimeout(closeTimer.current), []);
  const scheduleClose = useCallback(() => {
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setHover((h) => (h?.pinned ? h : null)), 350);
  }, []);
  useEffect(() => () => window.clearTimeout(closeTimer.current), []);

  const onLineHover: LineHover = useCallback(
    (key, at, pin) => {
      if (!key || !at) return scheduleClose();
      window.clearTimeout(closeTimer.current);
      setHover((h) => {
        if (h?.pinned && !pin && h.key !== key) return h;
        return { key, x: at.x, y: at.y, pinned: !!pin || (!!h?.pinned && h.key === key) };
      });
    },
    [scheduleClose],
  );

  return { hover, onLineHover, cancelClose, scheduleClose, close: () => setHover(null) };
}
