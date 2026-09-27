import { useCallback, useEffect, useReducer, useRef } from "react";
import { Box, Text, IconButton, HStack } from "@chakra-ui/react";
import { FiRefreshCw, FiMove } from "react-icons/fi";
import { useLifeState } from "@/context/life-state-context";
import { useWebSocket } from "@/context/websocket-context";
import {
  getUserTimezone,
  formatUserClock,
  userTimeZoneLabel,
} from "@/utils/user-timezone";
import {
  LIFE_STATE_BASE_WIDTH,
  applyDragDelta,
  canFetchLifeState,
  clampLifeStatePosition,
  resolveRenderPosition,
  resolveRenderScale,
  scaleForHandleDelta,
  scaleForWidth,
  widthForScale,
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

/** Dedicated bottom-right resize handle (large touch target). */
function ResizeGrip({
  onPointerDown,
}: {
  onPointerDown: (event: React.PointerEvent) => void;
}) {
  return (
    <Box
      data-testid="life-state-resize-handle"
      position="absolute"
      right="2px"
      bottom="2px"
      width="30px"
      height="30px"
      cursor="nwse-resize"
      touchAction="none"
      aria-hidden="true"
      onPointerDown={onPointerDown}
    >
      <Box
        position="absolute"
        right="5px"
        bottom="5px"
        width="14px"
        height="14px"
        borderRight="2px solid rgba(255,255,255,0.55)"
        borderBottom="2px solid rgba(255,255,255,0.55)"
        borderBottomRightRadius="4px"
      />
      <Box
        position="absolute"
        right="10px"
        bottom="10px"
        width="8px"
        height="8px"
        borderRight="2px solid rgba(255,255,255,0.3)"
        borderBottom="2px solid rgba(255,255,255,0.3)"
        borderBottomRightRadius="3px"
      />
    </Box>
  );
}

/**
 * Floating read-only observability panel for the authoritative backend
 * World/Life State. Overlay only: it never changes chat layout, avatar,
 * emotion, voice, or World State itself.
 *
 * Gestures (Pointer Events, mouse + touch unified):
 * - press-and-hold ANYWHERE on the panel (except the resize handle) and
 *   slide: the whole panel follows in real time; release persists position.
 * - press-and-hold the bottom-right handle and slide: the whole panel
 *   resizes live within MIN/MAX locks; release persists size.
 * No pinch handling exists by design.
 *
 * Data: fetched on mount / toggle-ON / manual refresh / conversation end
 * through the existing WebSocket (no polling, no scheduler, no LLM calls).
 */
export function LifeStateWidget() {
  const { enabled, snapshot, position, setPosition, size, setSize } =
    useLifeState();
  const { sendMessage, wsState } = useWebSocket();
  const boxRef = useRef<HTMLDivElement | null>(null);
  // Live gesture values: while a drag/resize is in flight these are the
  // SINGLE source of truth for rendering, so unrelated re-renders (clock
  // tick, snapshot update) can never snap the panel back mid-gesture and
  // cause jumps or jitter. Cleared on gesture end after persisting.
  const liveScaleRef = useRef<number | null>(null);
  const livePosRef = useRef<{ x: number; y: number } | null>(null);
  // Active single-pointer drag (panel move). Only one gesture at a time:
  // a resize in progress suppresses drag and vice versa.
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    baseX: number;
    baseY: number;
  } | null>(null);
  // Active resize from the bottom-right handle: only the start scale and
  // pointer origin are needed — the scale factor drives everything.
  const resizeRef = useRef<{
    pointerId: number;
    startX: number;
    startScale: number;
  } | null>(null);
  // Minute clock tick (single pending timeout, Stage-1 style: no interval).
  const [, forceClockTick] = useReducer((x: number) => x + 1, 0);
  // Latest socket state for the refresh guard without re-firing effects.
  const wsStateRef = useRef(wsState);
  wsStateRef.current = wsState;

  const refresh = useCallback(() => {
    // Never send while connecting/reconnecting: sendMessage itself toasts
    // error.websocketNotOpen on failure, which would be a false error here.
    // The reconnect lifecycle (ws OPEN effect) owns the first fetch.
    if (!canFetchLifeState(wsStateRef.current)) return;
    sendMessage({ type: "fetch-world-state", timezone: getUserTimezone() });
  }, [sendMessage]);

  // Fetch authoritative snapshot when the widget becomes visible and the
  // socket is already open. On fresh connects the ws OPEN effect fetches.
  useEffect(() => {
    if (enabled) refresh();
  }, [enabled, refresh]);

  // Keep the CURRENT TIME row fresh on minute boundaries while visible.
  // One pending timeout at a time; cleared when hidden/unmounted.
  useEffect(() => {
    if (!enabled) return;
    let timer: number | null = null;
    const schedule = () => {
      const now = new Date();
      const delay =
        60000 - (now.getSeconds() * 1000 + now.getMilliseconds()) + 50;
      timer = window.setTimeout(() => {
        forceClockTick();
        schedule();
      }, delay);
    };
    schedule();
    return () => {
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [enabled]);

  const applyDragMove = useCallback((clientX: number, clientY: number) => {
    const drag = dragRef.current;
    const node = boxRef.current;
    if (!drag || !node) return;
    const raw = applyDragDelta(
      { x: drag.baseX, y: drag.baseY },
      { x: drag.startX, y: drag.startY },
      { x: clientX, y: clientY },
    );
    // Live clamp against the CURRENT visual width (zoom-scaled rect), so a
    // resized panel keeps the same boundary contract without jumping.
    const visualWidth = node.getBoundingClientRect().width;
    const next = clampLifeStatePosition(
      raw,
      window.innerWidth,
      window.innerHeight,
      visualWidth,
    );
    node.style.left = `${next.x}px`;
    node.style.top = `${next.y}px`;
    node.style.right = "auto";
    livePosRef.current = next;
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
      const pos = { x: Math.round(rect.left), y: Math.round(rect.top) };
      dragRef.current = null;
      livePosRef.current = pos;
      setPosition(pos);
    },
    [setPosition],
  );

  // Whole-widget scaling: one zoom factor scales width, height, fonts,
  // padding, gaps, icons and radius together, so aspect and layout can
  // never drift apart. Horizontal handle travel drives the scale (vertical
  // travel is intentionally ignored to keep the aspect locked). Applied
  // live via style (no re-render churn).
  const applyResizeMove = useCallback((clientX: number) => {
    const resize = resizeRef.current;
    const node = boxRef.current;
    if (!resize || !node) return;
    const next = scaleForHandleDelta(
      resize.startScale,
      clientX - resize.startX,
      window.innerWidth,
    );
    node.style.zoom = String(next);
    liveScaleRef.current = next;
  }, []);

  const finishResize = useCallback(
    (pointerId: number) => {
      if (!boxRef.current || !resizeRef.current) return;
      if (resizeRef.current.pointerId !== pointerId) return;
      const node = boxRef.current;
      // offsetHeight is layout (pre-zoom) height; visual height follows zoom.
      // Persist from the live scale (single source), never from a zoomed rect.
      const liveScale = liveScaleRef.current ?? resizeRef.current.startScale;
      resizeRef.current = null;
      liveScaleRef.current = liveScale;
      setSize({
        width: widthForScale(liveScale),
        height: Math.max(1, Math.round(node.offsetHeight)),
      });
    },
    [setSize],
  );

  // Press-and-hold ANYWHERE on the panel (except the handle, which stops
  // propagation) starts a drag. Exactly one gesture runs at a time. The
  // drag base is the live position when re-grabbing mid-gesture state.
  const onPanelPointerDown = useCallback(
    (event: React.PointerEvent) => {
      if (resizeRef.current || dragRef.current) return;
      const node = boxRef.current;
      if (!node) return;
      node.setPointerCapture?.(event.pointerId);
      const rect = node.getBoundingClientRect();
      const base = livePosRef.current ?? position ?? {
        x: rect.left,
        y: rect.top,
      };
      dragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        baseX: base.x,
        baseY: base.y,
      };
    },
    [position],
  );

  // Bottom-right handle only: starts a resize, never a drag. The start
  // scale comes from the live ref (or persisted size), never from a
  // zoom-scaled rect, so consecutive gestures can't accumulate error.
  const onHandlePointerDown = useCallback((event: React.PointerEvent) => {
    event.stopPropagation();
    if (dragRef.current || resizeRef.current) return;
    const node = boxRef.current;
    if (!node) return;
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    resizeRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startScale: liveScaleRef.current ?? persistedScale,
    };
  }, []);

  // Single shared move/up path: exactly one gesture (drag XOR resize) can
  // be active, and only its owning pointer drives it.
  const onPanelPointerMove = useCallback(
    (event: React.PointerEvent) => {
      if (
        resizeRef.current &&
        resizeRef.current.pointerId === event.pointerId
      ) {
        applyResizeMove(event.clientX);
        return;
      }
      if (dragRef.current && dragRef.current.pointerId === event.pointerId) {
        applyDragMove(event.clientX, event.clientY);
      }
    },
    [applyDragMove, applyResizeMove],
  );

  const onPanelPointerUp = useCallback(
    (event: React.PointerEvent) => {
      finishResize(event.pointerId);
      finishDrag(event.pointerId);
    },
    [finishResize, finishDrag],
  );

  if (!enabled) return null;

  const energy = typeof snapshot?.energy === "number" ? snapshot.energy : null;
  // Same zone the backend uses for time_context; re-read each render so the
  // clock row always matches the active session timezone.
  const userTz = getUserTimezone();
  // RENDER single source: live gesture values win while a gesture is in
  // flight, so clock ticks / snapshot updates can never snap the panel
  // back mid-gesture (no jumps, no jitter, no magnet). Otherwise the
  // persisted values render (and re-sync the live mirrors).
  const persistedScale = size ? scaleForWidth(size.width) : 1;
  if (!resizeRef.current) liveScaleRef.current = persistedScale;
  if (!dragRef.current) livePosRef.current = null;
  const renderScale = resolveRenderScale(persistedScale, liveScaleRef.current);
  const renderPos = resolveRenderPosition(position, livePosRef.current);

  return (
    <Box
      ref={boxRef}
      data-testid="life-state-widget"
      position="absolute"
      zIndex={30}
      width={`${LIFE_STATE_BASE_WIDTH}px`}
      maxWidth="calc(100vw - 16px)"
      overflow="auto"
      bg="rgba(8, 15, 28, 0.82)"
      backdropFilter="blur(12px)"
      border="1px solid rgba(255,255,255,0.14)"
      borderRadius="md"
      p={2}
      pb={6}
      onPointerDown={onPanelPointerDown}
      onPointerMove={onPanelPointerMove}
      onPointerUp={onPanelPointerUp}
      onPointerCancel={onPanelPointerUp}
      style={{
        // Single visual-size source: zoom scales width, height, fonts,
        // padding, gaps, icons and radius together, preserving aspect.
        // touchAction none (inline style: guaranteed CSS) scopes gesture
        // control to the widget only: press-and-hold drag and handle
        // resize work on touch without the browser stealing the gesture,
        // while scrolling elsewhere is untouched.
        zoom: renderScale,
        touchAction: "none",
        transformOrigin: "top left",
        ...(renderPos
          ? { left: renderPos.x, top: renderPos.y }
          : { right: "12px", top: "64px" }),
      }}
    >
      <HStack
        justify="space-between"
        mb={1}
        cursor="move"
        style={{ touchAction: "none" }}
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
            label="Current Time"
            value={`${formatUserClock(new Date(), userTz)} ${userTimeZoneLabel(userTz)}`}
          />
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
      <ResizeGrip onPointerDown={onHandlePointerDown} />
    </Box>
  );
}
