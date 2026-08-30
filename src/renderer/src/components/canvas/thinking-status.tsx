import { useEffect, useRef, useState } from 'react';
import { Box, Spinner, Text } from '@chakra-ui/react';
import { FiAlertCircle } from 'react-icons/fi';
import { useTranslation } from 'react-i18next';
import { useAiState } from '@/context/ai-state-context';

// After this long without a first token, the model is very likely stuck.
// Show a warning instead of the plain waiting text so the user can tell a
// slow response apart from a hung one.
const STUCK_AFTER_MS = 60_000;

function ThinkingStatus(): JSX.Element | null {
  const { t } = useTranslation();
  const { aiState, firstTokenAt } = useAiState();
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const startedAtRef = useRef<number | null>(null);

  const visible = aiState === 'thinking-speaking' && firstTokenAt === null;

  useEffect(() => {
    if (!visible) {
      startedAtRef.current = null;
      setElapsedSeconds(0);
      return;
    }
    if (startedAtRef.current === null) {
      startedAtRef.current = Date.now();
    }
    const tick = () => {
      setElapsedSeconds(Math.floor((Date.now() - (startedAtRef.current ?? Date.now())) / 1000));
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [visible]);

  if (!visible) return null;

  const stuck = elapsedSeconds >= STUCK_AFTER_MS / 1000;

  return (
    <Box display="flex" justifyContent="center" width="100%">
      <Box
        display="inline-flex"
        alignItems="center"
        justifyContent="center"
        gap="8px"
        maxWidth="100%"
        px={{ base: '14px', lg: '18px' }}
        py={{ base: '8px', lg: '10px' }}
        borderRadius="full"
        bg={stuck ? '#E53E3E' : '#7C5CFF'}
        color="white"
        border="1px solid rgba(255, 255, 255, 0.18)"
        boxShadow="0 8px 28px rgba(0, 0, 0, 0.22)"
        backdropFilter="blur(12px)"
      >
        {stuck ? <FiAlertCircle size="16" /> : <Spinner size="sm" />}
        <Text
          fontSize={{ base: '13px', lg: '15px' }}
          fontWeight="medium"
          textAlign="center"
          lineHeight="1.3"
        >
          {stuck
            ? t('thinking.stuck', { seconds: elapsedSeconds })
            : `${t('aiState.thinking-speaking')} (${t('thinking.elapsed', { seconds: elapsedSeconds })})`}
        </Text>
      </Box>
    </Box>
  );
}

export default ThinkingStatus;
