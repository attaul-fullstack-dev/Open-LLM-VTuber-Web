/* eslint-disable function-paren-newline */
/* eslint-disable react/jsx-one-expression-per-line */
/* eslint-disable no-trailing-spaces */
/* eslint-disable no-nested-ternary */
/* eslint-disable import/order */
/* eslint-disable import/no-extraneous-dependencies */
/* eslint-disable react/require-default-props */
import { Box, Spinner, Flex, Text, Icon, Button } from '@chakra-ui/react';
import { sidebarStyles, chatPanelStyles } from './sidebar-styles';
import { MainContainer, ChatContainer, MessageList as ChatMessageList, Message as ChatMessage, Avatar as ChatAvatar } from '@chatscope/chat-ui-kit-react';
import '@chatscope/chat-ui-kit-styles/dist/default/styles.min.css';
import { useChatHistory } from '@/context/chat-history-context';
import { Global } from '@emotion/react';
import { useConfig } from '@/context/character-config-context';
import { useWebSocket } from '@/context/websocket-context';
import { FaTools, FaCheck, FaTimes } from 'react-icons/fa';
import { useTranslation } from 'react-i18next';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { cleanChatDisplayText } from '@/utils/clean-display-text';
import {
  AUTOFOLLOW_BOTTOM_THRESHOLD_PX,
  initialFollowOwnership,
  isAtBottom,
  nextFollowOwnership,
  shouldAdoptScrollPosition,
} from '@/utils/chat-autofollow';

const MESSAGE_RENDER_BATCH = 48;

// Main component
function ChatHistoryPanel(): JSX.Element {
  const { t } = useTranslation();
  const { messages, currentHistoryUid } = useChatHistory(); // Get messages directly from context
  const { confName } = useConfig();
  const { baseUrl } = useWebSocket();
  const userName = "Me";

  const validMessages = useMemo(() => messages.filter((msg) => msg.content || // Keep messages with content
     (msg.type === 'tool_call_status' && msg.status === 'running') || // Keep running tools
     (msg.type === 'tool_call_status' && msg.status === 'completed') || // Keep completed tools
     (msg.type === 'tool_call_status' && msg.status === 'error'), // Keep error tools
  ), [messages]);
  const [visibleMessageCount, setVisibleMessageCount] = useState(MESSAGE_RENDER_BATCH);

  // Auto-follow ownership: the system follows the bottom while streaming
  // until the user touches the chat list. Listeners live ONLY on this
  // list container, so composer/sidebar/menu touches never count.
  //
  // All sensing uses NATIVE listeners in the capture phase (never React
  // synthetic events): the bundled scrollbar library calls
  // stopPropagation() on wheel/keyboard events it handles, which silently
  // kills React's bubble-phase onWheel and starves the ownership tracker.
  // Capture listeners on our own container run before anything the
  // library does at its level, so no gesture is ever missed.
  const listHostRef = useRef<HTMLDivElement>(null);
  const followRef = useRef(initialFollowOwnership());
  const savedScrollTopRef = useRef(0);
  const pressTopRef = useRef(0);
  const firstMessageIdRef = useRef<string | number | null>(null);

  const listElement = (): HTMLDivElement | null => {
    const host = listHostRef.current;
    if (!host) return null;
    // The kit renders scrolling inside PerfectScrollbar's inner wrapper;
    // the outer .cs-message-list itself never scrolls.
    return (
      host.querySelector('.cs-message-list__scroll-wrapper') ??
      host.querySelector('.cs-message-list')
    );
  };

  const readAtBottom = (el: HTMLDivElement): boolean =>
    isAtBottom(
      el.scrollTop,
      el.scrollHeight,
      el.clientHeight,
      AUTOFOLLOW_BOTTOM_THRESHOLD_PX,
    );

  const handleListGesture = () => {
    const el = listElement();
    if (el) {
      savedScrollTopRef.current = el.scrollTop;
      pressTopRef.current = el.scrollTop;
    }
    followRef.current = nextFollowOwnership(followRef.current, {
      type: 'user-gesture',
    });
  };

  // Wheel needs a clamp gate that press gestures don't: every wheel tick
  // fires even when already clamped at the bottom, and a tick that moves
  // nothing produces no scroll event to release the control it just took.
  // Without the gate, wheeling against the bottom clamp would freeze
  // auto-follow until the user scrolls away and back. A downward push
  // while already at the bottom is therefore a no-op; an upward one still
  // arms, and its scroll event takes control through the normal path.
  const handleWheelGesture = (event: WheelEvent) => {
    const el = listElement();
    if (el && event.deltaY > 0 && readAtBottom(el)) return;
    handleListGesture();
  };

  const handleGestureEnd = () => {
    followRef.current = nextFollowOwnership(followRef.current, {
      type: 'gesture-end',
    });
  };

  // A press that never moved the viewport (a tap/click, not a drag) must
  // not leave adoption armed: without a scroll there is no scrollend to
  // disarm it later, and the next streaming chunk would be adopted as the
  // user's position. Feeding the current position through the scroll
  // transition releases back to follow mode when still at the bottom and
  // otherwise just disarms. A press that DID scroll (a drag, including a
  // touch drag whose momentum is still coming) stays armed; scrollend
  // disarms it. Mouse drags have no momentum, so release the arm there —
  // touch drags keep it for the momentum that follows finger lift.
  const handlePressEnd = (event: PointerEvent | TouchEvent) => {
    const el = listElement();
    const moved =
      el != null && Math.abs(el.scrollTop - pressTopRef.current) > 1;
    if (!moved) {
      if (!el) {
        handleGestureEnd();
        return;
      }
      followRef.current = nextFollowOwnership(followRef.current, {
        type: 'scroll',
        atBottom: readAtBottom(el),
      });
      return;
    }
    const pointerType =
      event instanceof PointerEvent ? event.pointerType : 'touch';
    if (pointerType !== 'touch') {
      handleGestureEnd();
    }
  };

  const handleListScroll = () => {
    const el = listElement();
    if (!el) return;
    const atBottom = readAtBottom(el);
    followRef.current = nextFollowOwnership(followRef.current, {
      type: 'scroll',
      atBottom,
    });
    if (shouldAdoptScrollPosition(followRef.current)) {
      // Gesture-backed scroll (or the follow-mode path): this really is
      // the user's position, so it becomes the new pin.
      savedScrollTopRef.current = el.scrollTop;
      return;
    }
    // Unarmed scroll while the user is in control: a programmatic move
    // (the list library re-anchoring on a streaming update, browser scroll
    // anchoring, or an enforcement echo). Adopting it would ratchet the pin
    // downward chunk by chunk, so re-pin instead — synchronously, driven
    // by this very event, never a timer.
    if (el.scrollTop !== savedScrollTopRef.current) {
      el.scrollTop = savedScrollTopRef.current;
    }
  };

  // Runs after every message render (parent layout effect runs after the
  // list's own update, so this wins over any forced bottom-follow).
  useLayoutEffect(() => {
    const el = listElement();
    if (!el) return;
    const firstId = validMessages[0]?.id ?? null;
    const prepended = firstMessageIdRef.current !== firstId;
    firstMessageIdRef.current = firstId;
    if (followRef.current.userControl) {
      // Older messages prepended above (load-older): accept the list's own
      // position keeping instead of pinning a stale offset.
      if (!prepended) {
        el.scrollTop = savedScrollTopRef.current;
      } else {
        savedScrollTopRef.current = el.scrollTop;
      }
    } else {
      el.scrollTop = el.scrollHeight;
      savedScrollTopRef.current = el.scrollTop;
    }
  });

  // A different conversation should start light, even when its transcript is huge.
  // It also gets fresh follow ownership: a stale pin from another chat must
  // never hold this list back.
  const currentHistoryUidRef = useRef(currentHistoryUid);
  useEffect(() => {
    setVisibleMessageCount(MESSAGE_RENDER_BATCH);
    if (currentHistoryUidRef.current !== currentHistoryUid) {
      currentHistoryUidRef.current = currentHistoryUid;
      followRef.current = initialFollowOwnership();
    }
  }, [currentHistoryUid]);

  // Native capture listeners for every scroll/gesture signal. They run on
  // our own container in the capture phase, i.e. before the scrollbar
  // library's target-level handlers (which stopPropagation() handled
  // wheels/keys and would otherwise starve React synthetic handlers).
  // All handlers below only touch refs, so the mount-once closures stay
  // correct for the life of the component.
  useEffect(() => {
    const host = listHostRef.current;
    if (!host) return;
    const passive = { capture: true, passive: true } as const;
    const active = { capture: true } as const;
    host.addEventListener('wheel', handleWheelGesture, passive);
    host.addEventListener('touchstart', handleListGesture, passive);
    host.addEventListener('touchmove', handleListGesture, passive);
    host.addEventListener('touchend', handlePressEnd, active);
    host.addEventListener('touchcancel', handlePressEnd, active);
    host.addEventListener('pointerdown', handleListGesture, active);
    host.addEventListener('pointerup', handlePressEnd, active);
    host.addEventListener('pointercancel', handlePressEnd, active);
    host.addEventListener('scroll', handleListScroll, passive);
    return () => {
      host.removeEventListener('wheel', handleWheelGesture, passive);
      host.removeEventListener('touchstart', handleListGesture, passive);
      host.removeEventListener('touchmove', handleListGesture, passive);
      host.removeEventListener('touchend', handlePressEnd, active);
      host.removeEventListener('touchcancel', handlePressEnd, active);
      host.removeEventListener('pointerdown', handleListGesture, active);
      host.removeEventListener('pointerup', handlePressEnd, active);
      host.removeEventListener('pointercancel', handlePressEnd, active);
      host.removeEventListener('scroll', handleListScroll, passive);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // scrollend fires after a scroll burst fully settles (including touch
  // momentum), which no other gesture event reliably marks. It is the
  // primary adoption off-switch. Attached on document-capture because the
  // event does not bubble.
  useEffect(() => {
    const onScrollEnd = (event: Event) => {
      const host = listHostRef.current;
      if (host && event.target instanceof Node && host.contains(event.target)) {
        handleGestureEnd();
      }
    };
    document.addEventListener('scrollend', onScrollEnd, true);
    return () => {
      document.removeEventListener('scrollend', onScrollEnd, true);
    };
  }, []);

  // Keyboard scrolling with focus outside the list (e.g. on body) produces
  // scroll events with no preceding list-level gesture. Arm those keys
  // globally, except while typing in an editable field. Same clamp gate as
  // the wheel: a downward key already at the bottom moves nothing and
  // would strand ownership with no scroll event to release it.
  useEffect(() => {
    const downKeys = [' ', 'PageDown', 'End', 'ArrowDown'];
    const upKeys = ['PageUp', 'Home', 'ArrowUp'];
    const onKeyDown = (event: KeyboardEvent) => {
      if (!downKeys.includes(event.key) && !upKeys.includes(event.key)) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }
      if (downKeys.includes(event.key)) {
        const el = listElement();
        if (el && readAtBottom(el)) return;
      }
      handleListGesture();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  const hasOlderMessages = validMessages.length > visibleMessageCount;
  const renderedMessages = hasOlderMessages
    ? validMessages.slice(-visibleMessageCount)
    : validMessages;

  const loadOlderMessages = () => {
    setVisibleMessageCount((current) => Math.min(current + MESSAGE_RENDER_BATCH, validMessages.length));
  };

  return (
    <Box
      h="full"
      overflow="hidden"
      bg="gray.900"
      ref={listHostRef}
    >
      <Global styles={chatPanelStyles} />
      <MainContainer>
        <ChatContainer>
          <ChatMessageList>
            {hasOlderMessages && (
              <Box display="flex" justifyContent="center" py="2">
                <Button
                  size="sm"
                  variant="ghost"
                  color="whiteAlpha.800"
                  _hover={{ bg: 'whiteAlpha.100', color: 'white' }}
                  onClick={loadOlderMessages}
                >
                  {t('history.loadOlder')}
                </Button>
              </Box>
            )}
            {validMessages.length === 0 ? (
              <Box
                display="flex"
                alignItems="center"
                justifyContent="center"
                height="100%"
                color="whiteAlpha.500"
                fontSize="sm"
              >
                {t('sidebar.noMessages')}
              </Box>
            ) : (
              renderedMessages.map((msg) => {
                // Check if it's a tool call message
                if (msg.type === 'tool_call_status') {
                  return (
                    // Render Tool Call Indicator using msg properties
                    <Flex
                      key={msg.id} // Use tool_id as key
                      {...sidebarStyles.toolCallIndicator.container}
                      alignItems="center"
                    >
                      <Icon
                        as={FaTools}
                        {...sidebarStyles.toolCallIndicator.icon}
                      />
                      <Text {...sidebarStyles.toolCallIndicator.text}>
                        {msg.status === "running"
                          ? t('toolCall.using', { name: msg.name, tool: msg.tool_name })
                          : t('toolCall.used', { name: msg.name, tool: msg.tool_name })}
                      </Text>
                      {/* Show spinner if running, checkmark if completed, maybe error icon? */}
                      {msg.status === "running" && (
                        <Spinner
                          size="xs"
                          color={sidebarStyles.toolCallIndicator.spinner.color}
                          ml={sidebarStyles.toolCallIndicator.spinner.ml}
                        />
                      )}
                      {msg.status === "completed" && (
                        <Icon
                          as={FaCheck}
                          {...sidebarStyles.toolCallIndicator.completedIcon}
                        />
                      )}
                      {/* Optional: Add an error icon */}
                      {msg.status === "error" && (
                        <Icon
                          as={FaTimes}
                          {...sidebarStyles.toolCallIndicator.errorIcon}
                        />
                      )}
                    </Flex>
                  );
                } 
                // Render Standard Chat Message (human or ai text)
                return (
                  <ChatMessage
                    key={msg.id}
                    model={{
                      message: cleanChatDisplayText(msg.content),
                      sentTime: msg.timestamp,
                      sender: msg.role === 'ai'
                        ? (msg.name || confName || 'AI')
                        : userName,
                      direction: msg.role === 'ai' ? 'incoming' : 'outgoing',
                      position: 'single',
                    }}
                    avatarPosition={msg.role === 'ai' ? 'tl' : 'tr'}
                    avatarSpacer={false}
                  >
                    <ChatAvatar>
                      {msg.role === 'ai' ? (
                        msg.avatar ? (
                          <img
                            src={`${baseUrl}/avatars/${msg.avatar}`}
                            alt="avatar"
                            style={{ width: '100%', height: '100%', borderRadius: '50%' }}
                            onError={(e) => {
                              const target = e.target as HTMLImageElement;
                              const fallbackName = msg.name || confName || 'A';
                              target.outerHTML = `<div style="width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; border-radius: 50%; background-color: var(--chakra-colors-blue-500); color: white; font-size: 14px;">${fallbackName[0].toUpperCase()}</div>`;
                            }}
                          />
                        ) : (
                          (msg.name && msg.name[0].toUpperCase()) ||
                            (confName && confName[0].toUpperCase()) ||
                            'A'
                        )
                      ) : (
                        userName[0].toUpperCase()
                      )}
                    </ChatAvatar>
                  </ChatMessage>
                );
              })
            )}
          </ChatMessageList>
        </ChatContainer>
      </MainContainer>
    </Box>
  );
}

export default ChatHistoryPanel;
