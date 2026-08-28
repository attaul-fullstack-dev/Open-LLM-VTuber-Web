/* eslint-disable import/no-extraneous-dependencies */
import { Button, Stack, Text } from '@chakra-ui/react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { settingStyles } from './setting-styles';
import { useAgentSettings } from '@/hooks/sidebar/setting/use-agent-settings';
import { SwitchField, NumberField } from './common';
import { useWebSocket } from '@/context/websocket-context';
import { useChatHistory } from '@/context/chat-history-context';
import { wsService, MessageEvent } from '@/services/websocket-service';
import {
  CharacterMemoryDialog,
  CharacterMemoryItem,
  CharacterMemoryLauncher,
} from './character-memory-dialog';

interface AgentProps {
  onSave?: (callback: () => void) => () => void
  onCancel?: (callback: () => void) => () => void
}

function Agent({ onSave, onCancel }: AgentProps): JSX.Element {
  const { t } = useTranslation();
  const { sendMessage, wsState } = useWebSocket();
  const { currentHistoryUid } = useChatHistory();
  const [memories, setMemories] = useState<CharacterMemoryItem[]>([]);
  const [memoryDialogOpen, setMemoryDialogOpen] = useState(false);
  const {
    settings,
    handleAllowProactiveSpeakChange,
    handleIdleSecondsChange,
    handleAllowButtonTriggerChange,
  } = useAgentSettings({ onSave, onCancel });

  useEffect(() => {
    const subscription = wsService.onMessage((message: MessageEvent) => {
      if (message.type === 'character-memory') {
        setMemories(message.memories || []);
      } else if (
        message.type === 'character-memory-deleted'
        || message.type === 'character-memory-reset'
        || message.type === 'character-state-reset'
      ) {
        // Refresh the list after any memory mutation.
        sendMessage({ type: 'fetch-character-memory' });
      }
    });
    if (wsState === 'OPEN') {
      sendMessage({ type: 'fetch-character-memory' });
    }
    return () => subscription.unsubscribe();
  }, [wsState, sendMessage]);

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
        <Text fontSize="sm" fontWeight="semibold">
          {t('settings.agent.characterMemory')}
        </Text>
        <Text fontSize="sm" color="fg.muted">
          {t('settings.agent.characterMemoryHelp')}
        </Text>
        <CharacterMemoryLauncher
          count={memories.length}
          onClick={() => setMemoryDialogOpen(true)}
        />
        <CharacterMemoryDialog
          memories={memories}
          open={memoryDialogOpen}
          disabled={wsState !== 'OPEN'}
          onOpenChange={setMemoryDialogOpen}
          onDelete={(memory) => sendMessage({
            type: 'delete-character-memory',
            text: memory.text,
          })}
          onDeleteAll={() => sendMessage({ type: 'reset-character-memory' })}
        />
      </Stack>

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

      <Stack gap={2} pt={4} borderTopWidth="1px" borderColor="whiteAlpha.200">
        <Text fontSize="sm" color="fg.muted">
          {t('settings.agent.resetCharacterStateHelp')}
        </Text>
        <Button
          colorPalette="red"
          variant="outline"
          disabled={wsState !== 'OPEN'}
          onClick={() => {
            if (window.confirm(t('settings.agent.resetCharacterStateConfirm'))) {
              sendMessage({ type: 'reset-character-state' });
            }
          }}
        >
          {t('settings.agent.resetCharacterState')}
        </Button>
      </Stack>
    </Stack>
  );
}

export default Agent;
