import { useCallback, useEffect, useRef, useState } from 'react';

const LS_POS_KEY = 'srs2t.tour.pos';

export interface DragPos {
  x: number;
  y: number;
}

function readPos(): DragPos | null {
  try {
    const stored = window.localStorage.getItem(LS_POS_KEY);
    if (!stored) return null;
    const parsed = JSON.parse(stored);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof parsed.x === 'number' &&
      typeof parsed.y === 'number'
    ) {
      return parsed as DragPos;
    }
    return null;
  } catch {
    return null;
  }
}

function writePos(pos: DragPos): void {
  try {
    window.localStorage.setItem(LS_POS_KEY, JSON.stringify(pos));
  } catch {
    /* ignore */
  }
}

function clampPos(x: number, y: number): DragPos {
  const clampedX = Math.max(8, Math.min(x, window.innerWidth - 60));
  const clampedY = Math.max(8, Math.min(y, window.innerHeight - 40));
  return { x: clampedX, y: clampedY };
}

export interface UseDragPositionResult {
  pos: DragPos | null;
  isDragging: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
  wasDragged: () => boolean;
}

export function useDragPosition(): UseDragPositionResult {
  const [pos, setPos] = useState<DragPos | null>(readPos);
  const [isDragging, setIsDragging] = useState(false);

  // Ref to track whether the most recent pointer interaction crossed the drag threshold
  const justDraggedRef = useRef(false);

  // Drag state tracked in refs to avoid stale closures in window listeners
  const dragState = useRef<{
    active: boolean;
    startPointerX: number;
    startPointerY: number;
    startElemX: number;
    startElemY: number;
    crossed: boolean;
    elemRef: HTMLElement | null;
  } | null>(null);

  const wasDragged = useCallback((): boolean => {
    const result = justDraggedRef.current;
    justDraggedRef.current = false;
    return result;
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    // Only handle primary button (left click / touch)
    if (e.button !== undefined && e.button !== 0) return;

    justDraggedRef.current = false;

    const target = e.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();

    dragState.current = {
      active: true,
      startPointerX: e.clientX,
      startPointerY: e.clientY,
      // Use the element's current top-left corner as the starting position
      startElemX: rect.left,
      startElemY: rect.top,
      crossed: false,
      elemRef: target,
    };

    setIsDragging(false);
  }, []);

  useEffect(() => {
    function onPointerMove(e: PointerEvent) {
      const state = dragState.current;
      if (!state || !state.active) return;

      const dx = e.clientX - state.startPointerX;
      const dy = e.clientY - state.startPointerY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (!state.crossed && dist <= 4) return;

      // Crossed the threshold — enter dragging mode
      if (!state.crossed) {
        state.crossed = true;
        setIsDragging(true);
        // Prevent text selection while dragging
        e.preventDefault();
      }

      const newX = state.startElemX + dx;
      const newY = state.startElemY + dy;
      const clamped = clampPos(newX, newY);
      setPos(clamped);
    }

    function onPointerUp(e: PointerEvent) {
      const state = dragState.current;
      if (!state || !state.active) return;

      state.active = false;
      setIsDragging(false);

      if (state.crossed) {
        // A real drag ended — persist position and suppress the upcoming click
        justDraggedRef.current = true;
        setPos(prev => {
          if (prev) writePos(prev);
          return prev;
        });
      }

      dragState.current = null;
    }

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
  }, []);

  // Re-clamp stored pos on window resize so the element never strands off-screen
  useEffect(() => {
    function onResize() {
      setPos(prev => {
        if (!prev) return prev;
        const clamped = clampPos(prev.x, prev.y);
        // Only update (and persist) if the position actually changed
        if (clamped.x === prev.x && clamped.y === prev.y) return prev;
        writePos(clamped);
        return clamped;
      });
    }

    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return { pos, isDragging, onPointerDown, wasDragged };
}
