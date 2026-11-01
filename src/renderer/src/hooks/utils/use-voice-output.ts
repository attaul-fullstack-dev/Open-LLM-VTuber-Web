import { useCallback, useSyncExternalStore } from 'react';
import { useWebSocket } from '@/context/websocket-context';
import { audioTaskQueue } from '@/utils/task-queue';
import { voiceOutputStore } from '@/utils/voice-output-store';

/**
 * Shared, synchronized hook for "Voice Output / TTS" setting.
 *
 * Backed by `voiceOutputStore` singleton with React 18 `useSyncExternalStore`.
 * Both the footer speaker button and the Sidebar Settings switch stay
 * 100% synchronized, reflect backend-confirmed state, and dispatch
 * toggle events to the backend to stop/start TTS generation and save ElevenLabs credits.
 */
export const useVoiceOutput = () => {
  const { sendMessage } = useWebSocket();

  const voiceOutputEnabled = useSyncExternalStore(
    voiceOutputStore.subscribe,
    voiceOutputStore.getSnapshot,
  );

  const backendConfirmed = useSyncExternalStore(
    voiceOutputStore.subscribe,
    voiceOutputStore.getBackendConfirmedSnapshot,
  );

  const setVoiceOutputEnabled = useCallback(
    (enabled: boolean) => {
      voiceOutputStore.setVoiceOutputEnabled(enabled, sendMessage);
      if (!enabled) {
        audioTaskQueue.clearQueue();
      }
    },
    [sendMessage],
  );

  const syncVoiceOutputToBackend = useCallback(() => {
    voiceOutputStore.syncToBackend(sendMessage);
  }, [sendMessage]);

  return {
    voiceOutputEnabled,
    backendConfirmed,
    setVoiceOutputEnabled,
    syncVoiceOutputToBackend,
  };
};
