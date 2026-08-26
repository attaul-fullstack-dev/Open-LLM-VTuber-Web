/* eslint-disable import/no-extraneous-dependencies */
import { Button, Stack, Text } from '@chakra-ui/react';
import { useTranslation } from 'react-i18next';
import { settingStyles } from './setting-styles';
import { useAgentSettings } from '@/hooks/sidebar/setting/use-agent-settings';
import { SwitchField, NumberField } from './common';
import { useWebSocket } from '@/context/websocket-context';
import { useChatHistory } from '@/context/chat-history-context';

interface AgentProps {
  onSave?: (callback: () => void) => () => void
  onCancel?: (callback: () => void) => () => void
}

function Agent({ onSave, onCancel }: AgentProps): JSX.Element {
  const { t } = useTranslation();
  const { sendMessage, wsState } = useWebSocket();
  const { currentHistoryUid } = useChatHistory();
  const {
    settings,
    handleAllowProactiveSpeakChange,
    handleIdleSecondsChange,
    handleAllowButtonTriggerChange,
  } = useAgentSettings({ onSave, onCancel });

  return (
    <Stack {...settingStyles.common.container}>
      <SwitchField
        label={t('settings.agent.allowProactiveSpeak')}
        checked={settings.allowProactiveSpeak}
        onChange={handleAllowProactiveSpeakChange}
      />

      {settings.allowProactiveSpeak && (
        <NumberField
          label={t('settings.agent.idleSecondsToSpeak')}
          value={settings.idleSecondsToSpeak}
          onChange={(value) => handleIdleSecondsChange(Number(value))}
          min={0}
          step={0.1}
          allowMouseWheel
        />
      )}

      <SwitchField
        label={t('settings.agent.allowButtonTrigger')}
        checked={settings.allowButtonTrigger}
        onChange={handleAllowButtonTriggerChange}
      />

      <Stack gap={2} pt={4} borderTopWidth="1px" borderColor="whiteAlpha.200">
        <Text fontSize="sm" color="fg.muted">
          {t('settings.agent.resetRelationshipHelp')}
        </Text>
        <Button
          colorPalette="red"
          variant="outline"
          disabled={!currentHistoryUid || wsState !== 'OPEN'}
          onClick={() => {
            if (window.confirm(t('settings.agent.resetRelationshipConfirm'))) {
              sendMessage({ type: 'reset-relationship' });
            }
          }}
        >
          {t('settings.agent.resetRelationship')}
        </Button>
      </Stack>
    </Stack>
  );
}

export default Agent;
