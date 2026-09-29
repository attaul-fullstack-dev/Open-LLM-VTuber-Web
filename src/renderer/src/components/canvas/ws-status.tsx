import { Box } from '@chakra-ui/react';
import React, { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { canvasStyles } from './canvas-styles';
import { useWSStatus } from '@/hooks/canvas/use-ws-status';
import { miliTokens } from '@/theme/design-tokens';

// Type definitions
interface StatusContentProps {
  textKey: string
}

// Reusable components
const StatusContent: React.FC<StatusContentProps> = ({ textKey }) => {
  const { t } = useTranslation();
  return t(textKey);
};
const MemoizedStatusContent = memo(StatusContent);

// Subtle connection chip: quiet dot + text when connected, tinted only
// when attention is needed (disconnected). Same hook, same behavior.
const WebSocketStatus = memo((): JSX.Element => {
  const {
    color, textKey, handleClick, isDisconnected,
  } = useWSStatus();

  return (
    <Box
      {...canvasStyles.wsStatus.container}
      backgroundColor={isDisconnected ? miliTokens.color.dangerSoft : 'rgba(10, 18, 32, 0.6)'}
      borderColor={isDisconnected ? miliTokens.color.danger : miliTokens.color.border}
      color={isDisconnected ? miliTokens.color.dangerText : miliTokens.color.textSecondary}
      onClick={handleClick}
      cursor={isDisconnected ? 'pointer' : 'default'}
      _hover={{
        opacity: isDisconnected ? 0.85 : 1,
      }}
    >
      <Box as="span" {...canvasStyles.wsStatus.dot} bg={color} />
      <MemoizedStatusContent textKey={textKey} />
    </Box>
  );
});

WebSocketStatus.displayName = 'WebSocketStatus';

export default WebSocketStatus;
