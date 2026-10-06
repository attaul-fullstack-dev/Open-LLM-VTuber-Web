/* eslint-disable no-shadow */
/* eslint-disable no-underscore-dangle */
/* eslint-disable @typescript-eslint/ban-ts-comment */
import { memo, useRef, useEffect, useState } from "react";
import { VStack, IconButton } from "@chakra-ui/react";
import { FiMinus, FiPlus, FiMaximize2 } from "react-icons/fi";
import { miliTokens } from "@/theme/design-tokens";
import { useLive2DConfig } from "@/context/live2d-config-context";
import { useIpcHandlers } from "@/hooks/utils/use-ipc-handlers";
import { useInterrupt } from "@/hooks/utils/use-interrupt";
import { useAudioTask } from "@/hooks/utils/use-audio-task";
import { useLive2DModel } from "@/hooks/canvas/use-live2d-model";
import { useLive2DResize } from "@/hooks/canvas/use-live2d-resize";
import { useAiState, AiStateEnum } from "@/context/ai-state-context";
import { useLive2DExpression } from "@/hooks/canvas/use-live2d-expression";
import { useLive2DIdleBehavior } from "@/hooks/canvas/use-live2d-idle-behavior";
import { useLive2DIdleFacial } from "@/hooks/canvas/use-live2d-idle-facial";
import { useBehaviorOwnership } from "@/hooks/canvas/use-behavior-ownership";
import { useForceIgnoreMouse } from "@/hooks/utils/use-force-ignore-mouse";
import { useMode } from "@/context/mode-context";

interface Live2DProps {
  showSidebar?: boolean;
}

export const Live2D = memo(
  ({ showSidebar }: Live2DProps): JSX.Element => {
    const { forceIgnoreMouse } = useForceIgnoreMouse();
    const { modelInfo } = useLive2DConfig();
    const { mode } = useMode();
    const internalContainerRef = useRef<HTMLDivElement>(null);
    const flashGuardCanvasRef = useRef<HTMLCanvasElement>(null);
    const flashGuardTimerRef = useRef<number | undefined>(undefined);
    const { aiState } = useAiState();
    const { resetExpression } = useLive2DExpression();
    const isPet = mode === 'pet';
    const [canvasStable, setCanvasStable] = useState(false);

    // Get canvasRef from useLive2DResize
    const {
      canvasRef, zoomIn, zoomOut, resetZoom,
    } = useLive2DResize({
      containerRef: internalContainerRef,
      modelInfo,
      showSidebar,
    });

    // Pass canvasRef to useLive2DModel
    const { isDragging, handlers } = useLive2DModel({
      modelInfo,
      canvasRef,
    });

    // Stage 5 — behavior ownership: ONE shared decision for "may autonomous
    // idle behavior run now?". Resolved from Stage 1 activity + ai-state + the
    // Stage 4 response-face bus + drag/motion + interruption + session switch.
    // Both Stage 2 and Stage 3 read the same suppression flags so they never
    // act against each other or against an ongoing response/interruption.
    const behavior = useBehaviorOwnership({ isDragging, isMotionPlaying: false });
    const { face: faceSuppressed, movement: movementSuppressed }
      = behavior.shouldSuppressAutonomous();

    // Stage 2 — safe autonomous idle movement when conversationally idle.
    // `isMotionPlaying` now carries the shared orchestrator decision (Movement
    // yields during a response/interruption; also yields to the safe baseline).
    useLive2DIdleBehavior({
      isDragging,
      isMotionPlaying: movementSuppressed,
    });

    // Stage 3 — autonomous idle facial micro-expressions. `isMotionPlaying`
    // carries the shared face decision (blocked during speaking/response/
    // active/interruption). Face channel ownership is preserved: a Stage 4
    // contextual face still wins over any idle selection.
    useLive2DIdleFacial({
      isDragging,
      isMotionPlaying: faceSuppressed,
    });

    // Setup hooks
    useIpcHandlers();
    useInterrupt();
    useAudioTask();

    // Reset expression to default when AI state becomes idle
    useEffect(() => {
      if (aiState === AiStateEnum.IDLE) {
        const lappAdapter = (window as any).getLAppAdapter?.();
        if (lappAdapter) {
          resetExpression(lappAdapter, modelInfo);
        }
      }
    }, [aiState, modelInfo, resetExpression]);

    // Hide the WebGL surface while the model and mask framebuffers are being
    // rebuilt. This prevents transient framebuffer clears from becoming a
    // visible white flash on mobile Chrome.
    useEffect(() => {
      setCanvasStable(false);
      if (!modelInfo?.url) {
        return undefined;
      }

      let secondFrame = 0;
      const readyTimer = window.setTimeout(() => {
        requestAnimationFrame(() => {
          secondFrame = requestAnimationFrame(() => setCanvasStable(true));
        });
      }, 1250);

      return () => {
        window.clearTimeout(readyTimer);
        if (secondFrame) cancelAnimationFrame(secondFrame);
      };
    }, [modelInfo?.url]);

    useEffect(() => () => {
      if (flashGuardTimerRef.current) {
        window.clearTimeout(flashGuardTimerRef.current);
      }
    }, []);

    // Expose setExpression for console testing
    // useEffect(() => {
    //   const testSetExpression = (expressionValue: string | number) => {
    //     const lappAdapter = (window as any).getLAppAdapter?.();
    //     if (lappAdapter) {
    //       setExpression(expressionValue, lappAdapter, `[Console Test] Set expression to: ${expressionValue}`);
    //     } else {
    //       console.error('[Console Test] LAppAdapter not found.');
    //     }
    //   };

    //   // Expose the function to the window object
    //   (window as any).testSetExpression = testSetExpression;
    //   console.log('[Debug] testSetExpression function exposed to window.');

    //   // Cleanup function to remove the function from window when the component unmounts
    //   return () => {
    //     delete (window as any).testSetExpression;
    //     console.log('[Debug] testSetExpression function removed from window.');
    //   };
    // }, [setExpression]);

    const showTapFlashGuard = () => {
      const source = canvasRef.current;
      const guard = flashGuardCanvasRef.current;
      if (!source || !guard || !canvasStable || !source.width || !source.height) return;

      try {
        guard.width = source.width;
        guard.height = source.height;
        const context = guard.getContext("2d");
        if (!context) return;
        context.clearRect(0, 0, guard.width, guard.height);
        context.drawImage(source, 0, 0, guard.width, guard.height);
        guard.style.opacity = "1";
        if (flashGuardTimerRef.current) {
          window.clearTimeout(flashGuardTimerRef.current);
        }
        flashGuardTimerRef.current = window.setTimeout(() => {
          guard.style.opacity = "0";
        }, 180);
      } catch {
        guard.style.opacity = "0";
      }
    };

    const handlePointerDown = (e: React.PointerEvent) => {
      showTapFlashGuard();
      handlers.onPointerDown(e);
    };

    const handleContextMenu = (e: React.MouseEvent) => {
      if (!isPet) {
        return;
      }

      e.preventDefault();
      console.log(
        "[ContextMenu] (Pet Mode) Right-click detected, requesting menu...",
      );
      window.api?.showContextMenu?.();
    };

    return (
      <div
        ref={internalContainerRef} // Ref for useLive2DResize if it observes this element
        id="live2d-internal-wrapper"
        style={{
          width: "100%",
          height: "100%",
          pointerEvents: isPet && forceIgnoreMouse ? "none" : "auto",
          overflow: "hidden",
          position: "relative",
          cursor: isDragging ? "grabbing" : "default",
          touchAction: "none",
          WebkitTapHighlightColor: "transparent",
        }}
        {...handlers}
        onPointerDown={handlePointerDown}
        onContextMenu={handleContextMenu}
      >
        <canvas
          id="canvas"
          ref={canvasRef}
          style={{
            width: "100%",
            height: "100%",
            pointerEvents: isPet && forceIgnoreMouse ? "none" : "auto",
            display: "block",
            opacity: canvasStable ? 1 : 0,
            transition: "opacity 180ms ease-out",
            willChange: "opacity",
            touchAction: "none",
            WebkitTapHighlightColor: "transparent",
            outline: "none",
            cursor: isDragging ? "grabbing" : "default",
          }}
        />
        <canvas
          ref={flashGuardCanvasRef}
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            display: "block",
            opacity: 0,
            pointerEvents: "none",
            transition: "opacity 50ms linear",
            zIndex: 2,
          }}
        />
        {!isPet && (
          <VStack
            display="flex"
            position="absolute"
            right="14px"
            top="76px"
            zIndex="30"
            gap="1"
            p="5px"
            borderRadius={miliTokens.radius.lg}
            bg={miliTokens.color.elevated}
            border="1px solid"
            borderColor={miliTokens.color.borderStrong}
            backdropFilter={miliTokens.blur.card}
            boxShadow={miliTokens.shadow.float}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <IconButton aria-label="Zoom in avatar" borderRadius={miliTokens.radius.md} color="white" bg={miliTokens.color.accent} _hover={{ filter: 'brightness(1.12)' }} _active={{ filter: 'brightness(1.2)' }} onClick={zoomIn} width={{ base: '44px', lg: '40px' }} minW={{ base: '44px', lg: '40px' }} height={{ base: '44px', lg: '40px' }}>
              <FiPlus size="21" strokeWidth="2.6" />
            </IconButton>
            <IconButton aria-label="Reset avatar zoom" borderRadius={miliTokens.radius.md} color={miliTokens.color.textSecondary} bg={miliTokens.color.surface} _hover={{ bg: 'whiteAlpha.100', color: miliTokens.color.textPrimary }} _active={{ bg: 'whiteAlpha.200' }} onClick={resetZoom} width={{ base: '44px', lg: '40px' }} minW={{ base: '44px', lg: '40px' }} height={{ base: '44px', lg: '40px' }}>
              <FiMaximize2 size="19" strokeWidth="2.4" />
            </IconButton>
            <IconButton aria-label="Zoom out avatar" borderRadius={miliTokens.radius.md} color={miliTokens.color.textSecondary} bg={miliTokens.color.surface} _hover={{ bg: 'whiteAlpha.100', color: miliTokens.color.textPrimary }} _active={{ bg: 'whiteAlpha.200' }} onClick={zoomOut} width={{ base: '44px', lg: '40px' }} minW={{ base: '44px', lg: '40px' }} height={{ base: '44px', lg: '40px' }}>
              <FiMinus size="21" strokeWidth="2.6" />
            </IconButton>
          </VStack>
        )}
      </div>
    );
  },
);

Live2D.displayName = "Live2D";

export { useInterrupt, useAudioTask };
