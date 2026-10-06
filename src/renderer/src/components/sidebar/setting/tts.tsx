import { Box, Text } from '@chakra-ui/react';
import { useTranslation } from 'react-i18next';
import { settingStyles } from './setting-styles';

// TTS has no configurable settings yet. This intentional empty state keeps
// the tab from reading as broken/unfinished — without faking functionality.
function TTS(): JSX.Element {
  const { t } = useTranslation();
  return (
    <Box {...settingStyles.emptyState.container}>
      <Text {...settingStyles.emptyState.title}>
        {t('settings.tts.emptyTitle')}
      </Text>
      <Text {...settingStyles.emptyState.body}>
        {t('settings.tts.emptyBody')}
      </Text>
    </Box>
  );
}

export default TTS;
