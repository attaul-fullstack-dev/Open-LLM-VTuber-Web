import { useCallback, useEffect, useRef } from "react";
import { Box, Text, IconButton, HStack } from "@chakra-ui/react";
import { FiRefreshCw, FiMove } from "react-icons/fi";
import { useLifeState } from "@/context/life-state-context";
import { useWebSocket } from "@/context/websocket-context";
import {
  LIFE_STATE_MIN_WIDTH,
  LIFE_STATE_MIN_HEIGHT,
  LIFE_STATE_MAX_WIDTH,
  LIFE_STATE_MAX_HEIGHT,
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
    startX: number;
    startY: number;
    baseX: number;
    baseY: number;
  } | null>(null);
  const sizeTimer = useRef<number | null>(null);

  const refresh = useCallback(() => {
    sendMessage({ type: "fetch-world-state" });
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

  const onDragStart = useCallback(
    (event: React.PointerEvent) => {
      if (!boxRef.current) return;
      const rect = boxRef.current.getBoundingClientRect();
      dragRef.current = {
        startX: event.clientX,
        startY: event.clientY,
        baseX: position?.x ?? rect.left,
        baseY: position?.y ?? rect.top,
      };
      (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
    },
    [position],
  );

  const onDragMove = useCallback((event: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag || !boxRef.current) return;
    const next = {
      x: drag.baseX + (event.clientX - drag.startX),
      y: drag.baseY + (event.clientY - drag.startY),
    };
    // Live clamp: keep the panel inside the viewport at all times.
    const rect = boxRef.current.getBoundingClientRect();
    next.x = Math.min(
      Math.max(next.x, 80 - rect.width),
      window.innerWidth - 80,
    );
    next.y = Math.min(Math.max(next.y, 0), window.innerHeight - 80);
    boxRef.current.style.left = `${next.x}px`;
    boxRef.current.style.top = `${next.y}px`;
    boxRef.current.style.right = "auto";
    dragRef.current = {
      ...drag,
      baseX: next.x,
      baseY: next.y,
      startX: event.clientX,
      startY: event.clientY,
    };
  }, []);

  const onDragEnd = useCallback(() => {
    if (!boxRef.current || !dragRef.current) return;
    const rect = boxRef.current.getBoundingClientRect();
    setPosition({ x: Math.round(rect.left), y: Math.round(rect.top) });
    dragRef.current = null;
  }, [setPosition]);

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
        onPointerDown={onDragStart}
        onPointerMove={onDragMove}
        onPointerUp={onDragEnd}
        onPointerCancel={onDragEnd}
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
