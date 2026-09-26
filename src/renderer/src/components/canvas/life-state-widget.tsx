import { useCallback, useEffect, useRef } from "react";
import { Box, Text, IconButton, HStack } from "@chakra-ui/react";
import { FiRefreshCw, FiMove } from "react-icons/fi";
import { useLifeState } from "@/context/life-state-context";
import { useWebSocket } from "@/context/websocket-context";
import { getUserTimezone } from "@/utils/user-timezone";
import {
  LIFE_STATE_MIN_WIDTH,
  LIFE_STATE_MIN_HEIGHT,
  LIFE_STATE_MAX_WIDTH,
  LIFE_STATE_MAX_HEIGHT,
  pinchDistance,
  pinchResizedSize,
  type LifeStatePointer,
  type LifeStateSize,
} from "@/utils/life-state-preference";

function formatLocalTime(iso: string | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <HStack justify="space-between" gap={3} py="1px">
      <Text
        fontSize="11px"
        color="whiteAlpha.600"
        textTransform="uppercase"
        letterSpacing="wider"
      >
        {label}
      </Text>
      <Text fontSize="12px" color="white" fontWeight="medium" textAlign="right">
        {value}
      </Text>
    </HStack>
  );
}

/**
 * Floating read-only observability panel for the authoritative backend
 * World/Life State. Overlay only: it never changes chat layout, avatar,
 * emotion, voice, or World State itself.
 *
 * Data: fetched on mount / toggle-ON / manual refresh / conversation end
 * through the existing WebSocket (no polling, no scheduler, no LLM calls).
 * Position + size persist in localStorage; viewport clamping keeps the
 * widget from getting lost off-screen.
 */
export function LifeStateWidget() {
  const { enabled, snapshot, position, setPosition, size, setSize } =
    useLifeState();
  const { sendMessage } = useWebSocket();
  const boxRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    baseX: number;
    baseY: number;
  } | null>(null);
  // Active pointers on the widget (touch + mouse unified via Pointer Events).
  const pointersRef = useRef<Map<number, LifeStatePointer>>(new Map());
  // Two-pointer pinch state. While set, drag is suppressed.
  const pinchRef = useRef<{
    startDistance: number;
    startSize: LifeStateSize;
  } | null>(null);
  const sizeTimer = useRef<number | null>(null);

  const refresh = useCallback(() => {
    sendMessage({ type: "fetch-world-state", timezone: getUserTimezone() });
  }, [sendMessage]);

  // Fetch authoritative snapshot when the widget becomes visible.
  useEffect(() => {
    if (enabled) refresh();
  }, [enabled, refresh]);

  // Persist resizes (debounced trailing write, not a loop).
  useEffect(() => {
    const node = boxRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect || rect.width < 10) return;
      if (sizeTimer.current !== null) window.clearTimeout(sizeTimer.current);
      sizeTimer.current = window.setTimeout(() => {
        setSize({
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        });
      }, 300);
    });
    observer.observe(node);
    return () => {
      observer.disconnect();
      if (sizeTimer.current !== null) window.clearTimeout(sizeTimer.current);
    };
  }, [setSize, enabled]);

  // Header press-and-hold starts a one-finger drag. Works identically for
  // mouse and touch: no hover, no click-click, no release required to move.
  const onHeaderPointerDown = useCallback(
    (event: React.PointerEvent) => {
      if (pinchRef.current) return;
      if (!boxRef.current) return;
      const rect = boxRef.current.getBoundingClientRect();
      dragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        baseX: position?.x ?? rect.left,
        baseY: position?.y ?? rect.top,
      };
    },
    [position],
  );

  const applyDragMove = useCallback((clientX: number, clientY: number) => {
    const drag = dragRef.current;
    const node = boxRef.current;
    if (!drag || !node) return;
    const next = {
      x: drag.baseX + (clientX - drag.startX),
      y: drag.baseY + (clientY - drag.startY),
    };
    // Live clamp: keep the panel inside the viewport at all times.
    const rect = node.getBoundingClientRect();
    next.x = Math.min(
      Math.max(next.x, 80 - rect.width),
      window.innerWidth - 80,
    );
    next.y = Math.min(Math.max(next.y, 0), window.innerHeight - 80);
    node.style.left = `${next.x}px`;
    node.style.top = `${next.y}px`;
    node.style.right = "auto";
    dragRef.current = {
      ...drag,
      baseX: next.x,
      baseY: next.y,
      startX: clientX,
      startY: clientY,
    };
  }, []);

  const finishDrag = useCallback(
    (pointerId: number) => {
      if (!boxRef.current || !dragRef.current) return;
      if (dragRef.current.pointerId !== pointerId) return;
      const rect = boxRef.current.getBoundingClientRect();
      setPosition({ x: Math.round(rect.left), y: Math.round(rect.top) });
      dragRef.current = null;
    },
    [setPosition],
  );

  // Box-level pointer tracking unifies mouse + touch. Capture on the box
  // (currentTarget) so moves keep flowing during press-and-hold slides.
  const onBoxPointerDown = useCallback((event: React.PointerEvent) => {
    const node = boxRef.current;
    if (!node) return;
    node.setPointerCapture?.(event.pointerId);
    pointersRef.current.set(event.pointerId, {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    });
    if (pointersRef.current.size === 2) {
      // Second finger down: enter pinch mode, cancel any drag so a
      // pinch is never mistaken for a drag.
      const [a, b] = [...pointersRef.current.values()];
      const rect = node.getBoundingClientRect();
      dragRef.current = null;
      pinchRef.current = {
        startDistance: pinchDistance(a, b),
        startSize: { width: rect.width, height: rect.height },
      };
    }
  }, []);

  const onBoxPointerMove = useCallback(
    (event: React.PointerEvent) => {
      const tracked = pointersRef.current.get(event.pointerId);
      if (!tracked) {
        // Pointer not tracked (e.g. started outside): drag only if a
        // header-initiated drag is already in progress for this pointer.
        if (dragRef.current?.pointerId === event.pointerId) {
          applyDragMove(event.clientX, event.clientY);
        }
        return;
      }
      tracked.x = event.clientX;
      tracked.y = event.clientY;
      const pinch = pinchRef.current;
      if (pinch && pointersRef.current.size >= 2) {
        const [a, b] = [...pointersRef.current.values()];
        const next = pinchResizedSize(
          pinch.startDistance,
          pinchDistance(a, b),
          pinch.startSize,
        );
        const node = boxRef.current;
        if (node) {
          node.style.width = `${next.width}px`;
          node.style.height = `${next.height}px`;
        }
        return;
      }
      if (dragRef.current?.pointerId === event.pointerId) {
        applyDragMove(event.clientX, event.clientY);
      }
    },
    [applyDragMove],
  );

  const onBoxPointerUp = useCallback(
    (event: React.PointerEvent) => {
      pointersRef.current.delete(event.pointerId);
      if (pinchRef.current && pointersRef.current.size < 2) {
        // Pinch finished: persist the live size, then require a fresh
        // header press for any further drag (no accidental drag resume).
        const node = boxRef.current;
        pinchRef.current = null;
        if (node) {
          const rect = node.getBoundingClientRect();
          setSize({
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          });
        }
      }
      finishDrag(event.pointerId);
    },
    [finishDrag, setSize],
  );

  if (!enabled) return null;

  const energy = typeof snapshot?.energy === "number" ? snapshot.energy : null;

  return (
    <Box
      ref={boxRef}
      data-testid="life-state-widget"
      position="absolute"
      zIndex={30}
      width={size ? `${size.width}px` : "232px"}
      minWidth={`${LIFE_STATE_MIN_WIDTH}px`}
      maxWidth={`${LIFE_STATE_MAX_WIDTH}px`}
      minHeight={`${LIFE_STATE_MIN_HEIGHT}px`}
      maxHeight={`${LIFE_STATE_MAX_HEIGHT}px`}
      overflow="auto"
      resize="both"
      bg="rgba(8, 15, 28, 0.82)"
      backdropFilter="blur(12px)"
      border="1px solid rgba(255,255,255,0.14)"
      borderRadius="md"
      p={2}
      // touch-action none scopes gesture control to the widget only:
      // press-and-hold drag + two-finger pinch work on touch without the
      // browser stealing the gesture, while scrolling elsewhere is untouched.
      touchAction="none"
      onPointerDown={onBoxPointerDown}
      onPointerMove={onBoxPointerMove}
      onPointerUp={onBoxPointerUp}
      onPointerCancel={onBoxPointerUp}
      style={
        position
          ? { left: position.x, top: position.y }
          : { right: "12px", top: "64px" }
      }
    >
      <HStack
        justify="space-between"
        mb={1}
        cursor="move"
        touchAction="none"
        onPointerDown={onHeaderPointerDown}
        userSelect="none"
      >
        <HStack gap={1}>
          <FiMove size={12} color="rgba(255,255,255,0.5)" />
          <Text
            fontSize="11px"
            fontWeight="bold"
            color="whiteAlpha.800"
            letterSpacing="wider"
          >
            MILI LIFE STATE
          </Text>
        </HStack>
        <IconButton
          aria-label="Refresh life state"
          size="2xs"
          variant="ghost"
          color="whiteAlpha.700"
          onClick={(e) => {
            e.stopPropagation();
            refresh();
          }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <FiRefreshCw size={12} />
        </IconButton>
      </HStack>
      {snapshot?.error ? (
        <Text fontSize="12px" color="orange.300">
          World state unavailable
        </Text>
      ) : !snapshot ? (
        <Text fontSize="12px" color="whiteAlpha.600">
          Waiting for world state…
        </Text>
      ) : (
        <>
          <Row label="Activity" value={snapshot.activity ?? "—"} />
          <Row
            label="Energy"
            value={energy !== null ? `${energy} / 100` : "—"}
          />
          <Row label="Mood" value={snapshot.mood ?? "—"} />
          <Row label="Location" value={snapshot.location ?? "—"} />
          <Row label="Time" value={snapshot.time_context ?? "—"} />
          <Row
            label="Started"
            value={formatLocalTime(snapshot.activity_started_at)}
          />
          <Row
            label="Updated"
            value={formatLocalTime(snapshot.last_update_at)}
          />
        </>
      )}
    </Box>
  );
}
