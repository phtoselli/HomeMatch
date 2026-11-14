import { useCallback, useEffect, useRef, useState } from "react";
import type { LineHover } from "../map/MapView";

export interface HoverState {
  key: string;
  x: number;
  y: number;
  pinned: boolean;
}

/**
 * Popover da linha sob o mouse: fica aberto enquanto o mouse está na linha ou nele (pequena folga
 * para ir de um ao outro). Clique fixa; fixado, passar sobre outra linha não troca o popover.
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
