import { Box, Flex, IconButton, Portal, Text } from '@chakra-ui/react';
import React, { useCallback, useEffect, useState } from 'react';
import { useHistory, useLocation } from 'react-router-dom';
import { useCore } from 'store/core';
import { TOUR_STORIES } from './tour.config';
import { useDragPosition } from './useDragPosition';

const LS_KEY = 'srs2t.tour.collapsed';

function readCollapsed(): boolean {
  try {
    const stored = window.localStorage.getItem(LS_KEY);
    if (stored === null) return false; // first visit → expanded
    return stored === 'true';
  } catch {
    return false;
  }
}

function writeCollapsed(val: boolean): void {
  try {
    window.localStorage.setItem(LS_KEY, String(val));
  } catch {
    /* ignore */
  }
}

/** Compass/map icon rendered as inline SVG — no external dependency. */
function CompassIcon() {
  return (
    <Box
      as="svg"
      w="16px"
      h="16px"
      viewBox="0 0 16 16"
      fill="none"
      flexShrink={0}
    >
      <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
      <polygon points="8,3 10,8 8,7 6,8" fill="currentColor" opacity="0.9" />
      <polygon points="8,13 6,8 8,9 10,8" fill="currentColor" opacity="0.4" />
    </Box>
  );
}

/** Chevron-down icon (rotates to up when collapsed card open). */
function ChevronIcon({ up }: { up?: boolean }) {
  return (
    <Box
      as="svg"
      w="16px"
      h="16px"
      viewBox="0 0 16 16"
      fill="none"
      style={{
        transform: up ? 'rotate(180deg)' : undefined,
        transition: 'transform 0.18s',
      }}
    >
      <path
        d="M4 6l4 4 4-4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Box>
  );
}

export function PrototypeTour() {
  const [collapsed, setCollapsed] = useState<boolean>(readCollapsed);
  const { activeAccountId: account, envId: env } = useCore();
  const history = useHistory();
  const location = useLocation();
  const { pos, isDragging, onPointerDown, wasDragged } = useDragPosition();

  const toggle = useCallback(() => {
    setCollapsed(prev => {
      const next = !prev;
      writeCollapsed(next);
      return next;
    });
  }, []);

  // The new-flow wizard is a full-bleed workspace — its source/target tile
  // grid extends under the card's fixed anchor, so an expanded card would
  // hide tiles (e.g. MySQL). Auto-collapse when ENTERING the wizard; an
  // explicit pill click can still re-expand there.
  const onWizard = location.pathname.includes('/new/source-to-target');
  useEffect(() => {
    if (onWizard) setCollapsed(true);
  }, [onWizard]);

  // The wizard's footer bar (Exit / Back / Next) also sits bottom-right —
  // lift the anchor above it there so the pill never covers Next.
  // Only applies when the user hasn't dragged to a custom position.
  const anchorBottom = onWizard ? '84px' : '20px';

  if (!account || !env) return null;

  const pathname = location.pathname;

  // Navigate to a story and get out of the way: the card collapses to the
  // pill so it never covers the surface the user is about to explore.
  const goToStory = (route: string) => {
    history.push(route);
    setCollapsed(true);
    writeCollapsed(true);
  };

  // Build positioning style — if user has dragged, use explicit top/left;
  // otherwise fall through to the default bottom/right anchor. The stored
  // position is shared by the pill and the 360px card, so clamp per the
  // element being rendered: whichever it is must sit fully on-screen even
  // when the other was dragged flush against a viewport edge.
  const posFor = (elemW: number, elemH: number): React.CSSProperties =>
    pos
      ? {
          position: 'fixed',
          left: Math.max(8, Math.min(pos.x, window.innerWidth - elemW - 8)),
          top: Math.max(8, Math.min(pos.y, window.innerHeight - elemH - 8)),
          bottom: 'auto',
          right: 'auto',
        }
      : {};
  const PILL_W = 150;
  const PILL_H = 34;
  const CARD_W = 360;
  const CARD_MIN_VISIBLE_H = 120; // keep at least the header + first story reachable

  // ------------------------------------------------------------------
  // Collapsed pill button
  // ------------------------------------------------------------------
  if (collapsed) {
    return (
      <Portal>
        <Flex
          as="button"
          onPointerDown={onPointerDown}
          onClick={() => {
            if (wasDragged()) return;
            toggle();
          }}
          position="fixed"
          bottom={pos ? 'auto' : anchorBottom}
          right={pos ? 'auto' : '20px'}
          style={{
            ...posFor(PILL_W, PILL_H),
            touchAction: 'none',
            cursor: isDragging ? 'grabbing' : 'pointer',
          }}
          zIndex={1390}
          align="center"
          gap="6px"
          px="14px"
          py="9px"
          bg="primary"
          color="white"
          borderRadius="full"
          boxShadow="0 2px 12px rgba(0,0,0,0.22)"
          _hover={{
            bg: 'brand',
            transform: 'translateY(-1px)',
            boxShadow: '0 4px 16px rgba(0,0,0,0.26)',
          }}
          _active={{ bg: 'brand', transform: 'translateY(0)' }}
          transition="all 0.15s"
          border="none"
          outline="none"
          aria-label="Open Prototype Guide"
        >
          <CompassIcon />
          <Text
            fontSize="13px"
            fontWeight="600"
            lineHeight="1"
            color="white"
            userSelect="none"
          >
            Prototype Guide
          </Text>
        </Flex>
      </Portal>
    );
  }

  // ------------------------------------------------------------------
  // Expanded card
  // ------------------------------------------------------------------
  return (
    <Portal>
      <Box
        position="fixed"
        bottom={pos ? 'auto' : anchorBottom}
        right={pos ? 'auto' : '20px'}
        style={posFor(CARD_W, CARD_MIN_VISIBLE_H)}
        zIndex={1390}
        w="360px"
        maxH="calc(100vh - 40px)"
        bg="white"
        borderRadius="10px"
        boxShadow="0 4px 24px rgba(0,0,0,0.18), 0 1px 4px rgba(0,0,0,0.08)"
        border="1px solid"
        borderColor="gray.300"
        display="flex"
        flexDir="column"
        overflow="hidden"
      >
        {/* Header — drag handle for the expanded card */}
        <Flex
          align="center"
          justify="space-between"
          px="16px"
          py="12px"
          bg="primary"
          flexShrink={0}
          onPointerDown={onPointerDown}
          style={{
            touchAction: 'none',
            cursor: isDragging ? 'grabbing' : 'grab',
            userSelect: 'none',
          }}
        >
          <Flex align="center" gap="8px">
            <Box color="white" opacity={0.9}>
              <CompassIcon />
            </Box>
            <Text
              fontSize="13px"
              fontWeight="700"
              color="white"
              lineHeight="1.3"
              letterSpacing="0.01em"
            >
              Scheduled Retry — Prototype Guide
            </Text>
          </Flex>
          <IconButton
            aria-label="Collapse Prototype Guide"
            icon={<ChevronIcon up />}
            onClick={e => {
              // Stop propagation so the header's pointerdown doesn't
              // interfere, but the movement threshold already guards clicks.
              e.stopPropagation();
              if (wasDragged()) return;
              toggle();
            }}
            size="xs"
            variant="ghost"
            color="white"
            _hover={{ bg: 'whiteAlpha.300' }}
            _active={{ bg: 'whiteAlpha.400' }}
            minW="28px"
            h="28px"
            borderRadius="6px"
          />
        </Flex>

        {/* Scrollable body */}
        <Box overflowY="auto" flex="1" px="16px" pt="12px" pb="4px">
          {/* Intro */}
          <Text
            textStyle="R7"
            color="font-secondary"
            mb="12px"
            lineHeight="1.5"
          >
            S2T data flows recover from transient failures automatically.
            Explore the four surfaces of the proposed UX:
          </Text>

          {/* Story items */}
          <Box as="ol" listStyleType="none" m={0} p={0}>
            {TOUR_STORIES.map((story, idx) => {
              const route = story.getRoute(account, env);
              const active = story.isActive(pathname, account, env);

              return (
                <Box
                  key={story.id}
                  as="li"
                  onClick={() => goToStory(route)}
                  cursor="pointer"
                  borderRadius="7px"
                  mb="4px"
                  px="10px"
                  py="9px"
                  bg={active ? 'purple.10' : 'transparent'}
                  borderLeft={active ? '3px solid' : '3px solid transparent'}
                  borderLeftColor={active ? 'primary' : 'transparent'}
                  _hover={{ bg: active ? 'purple.10' : 'gray.100' }}
                  _active={{ bg: 'gray.150' }}
                  transition="background 0.13s"
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e: React.KeyboardEvent) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      goToStory(route);
                    }
                  }}
                  aria-current={active ? 'page' : undefined}
                >
                  <Flex align="flex-start" gap="10px">
                    {/* Number chip */}
                    <Flex
                      flexShrink={0}
                      align="center"
                      justify="center"
                      w="22px"
                      h="22px"
                      borderRadius="full"
                      bg={active ? 'primary' : 'gray.150'}
                      mt="1px"
                    >
                      <Text
                        fontSize="11px"
                        fontWeight="700"
                        color={active ? 'white' : 'gray.700'}
                        lineHeight="1"
                        userSelect="none"
                      >
                        {idx + 1}
                      </Text>
                    </Flex>

                    <Box flex="1" minW={0}>
                      <Text
                        textStyle="M6"
                        color={active ? 'primary' : 'font'}
                        mb="2px"
                      >
                        {story.title}
                      </Text>
                      <Text
                        textStyle="R7"
                        color="font-secondary"
                        lineHeight="1.45"
                      >
                        {story.blurb}
                      </Text>
                    </Box>
                  </Flex>
                </Box>
              );
            })}
          </Box>
        </Box>

        {/* Footer */}
        <Box
          px="16px"
          py="10px"
          borderTop="1px solid"
          borderColor="gray.150"
          flexShrink={0}
        >
          <Text
            fontSize="10px"
            fontWeight="400"
            color="font-secondary"
            lineHeight="1.4"
            opacity={0.75}
          >
            PRD CORE-2320 · UI CORE-2446 · mock data, no real backend
          </Text>
        </Box>
      </Box>
    </Portal>
  );
}
