import { Box, IconButton, Text } from '@chakra-ui/react';
import { memo } from 'react';
import { FiX } from 'react-icons/fi';
import { canvasStyles } from './canvas-styles';
import { useSubtitleDisplay } from '@/hooks/canvas/use-subtitle-display';
import { useSubtitle } from '@/context/subtitle-context';
import { cleanChatDisplayText } from '@/utils/clean-display-text';

// Type definitions
interface SubtitleTextProps {
  text: string
}

// Reusable components
const SubtitleText = memo(({ text }: SubtitleTextProps) => (
  <Text {...canvasStyles.subtitle.text}>
    {text}
  </Text>
));

SubtitleText.displayName = 'SubtitleText';

// Main component
const Subtitle = memo((): JSX.Element | null => {
  const { subtitleText, isLoaded } = useSubtitleDisplay();
  const { showSubtitle, subtitleDismissed, dismissSubtitle } = useSubtitle();

  const cleanSubtitle = cleanChatDisplayText(subtitleText || '');

  if (!isLoaded || !cleanSubtitle || !showSubtitle || subtitleDismissed) return null;

  return (
    <Box {...canvasStyles.subtitle.container}>
      <IconButton
        aria-label="Hide subtitles"
        title="Hide subtitles"
        onClick={dismissSubtitle}
        {...canvasStyles.subtitle.closeButton}
      >
        <FiX />
      </IconButton>
      <SubtitleText text={cleanSubtitle} />
    </Box>
  );
});

Subtitle.displayName = 'Subtitle';

export default Subtitle;
