/**
 * DemoPathBeacon — animated "Demo path" indicator that floats above the MySQL
 * tile on the source picker and the Snowflake tile on the target picker.
 *
 * Implementation notes:
 * - Self-contained; does NOT modify product picker components.
 * - Active only on the new-flow wizard route (/new/source-to-target).
 * - Locates tiles by scanning button elements whose text content matches the
 *   target name (MySQL / Snowflake). The SourceComponent in SourcesGrid renders
 *   each tile as a Chakra Button whose deepest text node is the connector name,
 *   so we scan all [role="button"] and <button> elements for textContent match.
 * - Repositions via a 500ms poll + resize + capture-phase scroll listeners so
 *   the badge tracks the tile as the layout shifts and disappears when the tile
 *   leaves the DOM (e.g. after clicking, the picker unmounts).
 * - Non-interactive: pointerEvents none, aria-hidden true.
 */
import { keyframes } from '@emotion/react';
import { Portal } from '@chakra-ui/react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';

const WIZARD_PATH_SEGMENT = '/new/source-to-target';

/** Gentle bounce: 0 → -4px → 0, 1.2s infinite. */
const bounceAnim = keyframes`
  0%, 100% { transform: translateY(0); }
  50%       { transform: translateY(-4px); }
`;

/**
 * Names to target, resolved per picker: MySQL appears as a tile in BOTH grids
 * (it is also offered as a target), so anchoring both names whenever present
 * would put two beacons on the target picker. The visible picker heading
 * ("Select the Data Source…" / "Select the Data Target…") tells us which
 * step is showing, and each step gets exactly one beacon.
 */
function beaconTargetsForCurrentPicker(): string[] {
  const text = document.body.textContent ?? '';
  if (text.includes('Select the Data Target')) return ['Snowflake'];
  if (text.includes('Select the Data Source')) return ['MySQL'];
  return [];
}

interface BeaconPos {
  left: number;
  top: number;
  key: string; // tile label, used for keying React elements
}

/**
 * Find a DOM tile element for the given connector name.
 * The SourceComponent in SourcesGrid renders each tile as a Chakra Button
 * (<button>) with a Text child whose text content is the connector name.
 * We scan all buttons, find text spans whose trimmed content equals `name`,
 * then walk up to the closest button ancestor (the tile card).
 */
function findTileElement(name: string): Element | null {
  // Walk all text nodes in the document looking for one whose trimmed content
  // equals the connector name, then find the enclosing button tile.
  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    null,
  );
  let node: Text | null;
  while ((node = walker.nextNode() as Text | null)) {
    if (node.textContent?.trim() === name) {
      // Walk up to the nearest button ancestor — that is the tile card.
      let el: Element | null = node.parentElement;
      while (
        el &&
        el.tagName !== 'BUTTON' &&
        el.getAttribute('role') !== 'button'
      ) {
        el = el.parentElement;
      }
      if (el) {
        const rect = el.getBoundingClientRect();
        // Confirm it's a real sized tile (not a ghost / zero-size element).
        if (rect.width > 50 && rect.height > 50) {
          return el;
        }
      }
    }
  }
  return null;
}

/** Compute fixed-position coords to pin the badge onto a tile's top edge. */
function computePos(
  tile: Element,
  badgeWidth: number,
): { left: number; top: number } {
  const rect = tile.getBoundingClientRect();
  const left = rect.left + rect.width / 2 - badgeWidth / 2;
  // Straddle the tile's own top border (half above, half on the card):
  // floating it fully above the tile lands inside the card of the row
  // above in the tight picker grid and reads as anchored to the wrong tile.
  const top = rect.top - 13;
  return { left, top };
}

export function DemoPathBeacon() {
  const location = useLocation();
  const onWizard = location.pathname.includes(WIZARD_PATH_SEGMENT);

  const [positions, setPositions] = useState<BeaconPos[]>([]);
  const rafRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const measure = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      const BADGE_WIDTH = 76; // approximate rendered width of the pill
      const next: BeaconPos[] = [];
      for (const name of beaconTargetsForCurrentPicker()) {
        const tile = findTileElement(name);
        if (tile) {
          const pos = computePos(tile, BADGE_WIDTH);
          next.push({ ...pos, key: name });
        }
      }
      setPositions(next);
    });
  }, []);

  useEffect(() => {
    if (!onWizard) {
      setPositions([]);
      return;
    }

    // Poll every 500ms so we react to tile mount/unmount (picker step changes).
    timerRef.current = setInterval(measure, 500);
    // Also measure immediately.
    measure();

    // Capture-phase scroll catches nested scroll containers (picker's SimpleGrid).
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);

    return () => {
      if (timerRef.current !== null) clearInterval(timerRef.current);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
      setPositions([]);
    };
  }, [onWizard, measure]);

  if (!onWizard || positions.length === 0) return null;

  return (
    <Portal>
      {positions.map(pos => (
        <div
          key={pos.key}
          aria-hidden="true"
          style={{
            position: 'fixed',
            left: pos.left,
            top: pos.top,
            zIndex: 1380,
            pointerEvents: 'none',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
          }}
        >
          {/* Pill label */}
          <div
            style={{
              background: 'var(--chakra-colors-primary, #6B46C1)',
              color: '#ffffff',
              fontSize: '11px',
              fontWeight: 700,
              lineHeight: 1,
              padding: '5px 10px',
              borderRadius: '999px',
              whiteSpace: 'nowrap',
              boxShadow: '0 2px 8px rgba(0,0,0,0.20)',
              animation: `${bounceAnim} 1.2s ease-in-out infinite`,
            }}
          >
            Demo path
          </div>
          {/* Down-pointing caret */}
          <div
            style={{
              width: 0,
              height: 0,
              borderLeft: '5px solid transparent',
              borderRight: '5px solid transparent',
              borderTop: '6px solid var(--chakra-colors-primary, #6B46C1)',
              marginTop: '-1px',
            }}
          />
        </div>
      ))}
    </Portal>
  );
}
