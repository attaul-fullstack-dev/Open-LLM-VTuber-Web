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
import { useEffect, useMemo, useState } from 'react';

const MESSAGE_RENDER_BATCH = 48;

const cleanDisplayText = (value: string) => value
  .replace(/\[[a-z][a-z0-9_-]*\]\s*/gi, '')
  .replace(/\*([^*]+)\*/g, '$1')
  .replace(/([.!?])(?=[A-Z])/g, '$1 ')
  .replace(/\s+/g, ' ')
  .trim();

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

  // A different conversation should start light, even when its transcript is huge.
  useEffect(() => {
    setVisibleMessageCount(MESSAGE_RENDER_BATCH);
  }, [currentHistoryUid]);

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
                      message: cleanDisplayText(msg.content),
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
