import { Box, Text } from '@chakra-ui/react';
import { useTranslation } from 'react-i18next';
import { useAiState } from '@/context/ai-state-context';
import { footerStyles } from './footer-styles';

function AIStateIndicator(): JSX.Element | null {
  const { t } = useTranslation();
  const { aiState, firstTokenAt } = useAiState();
  const styles = footerStyles.aiIndicator;

  // While waiting for the first token, the centered ThinkingStatus pill
  // already shows an animated "thinking" state with an elapsed timer, so
  // avoid duplicating a static label here.
  if (aiState === 'thinking-speaking' && firstTokenAt === null) return null;

  return (
    <Box {...styles.container}>
      <Text {...styles.text}>{t(`aiState.${aiState}`)}</Text>
    </Box>
  );
}

export default AIStateIndicator;
