import { useCallback, useState } from 'react';
import { audioManager } from '@/utils/audio-manager';
import { audioTaskQueue } from '@/utils/task-queue';
import { useWebSocket } from '@/context/websocket-context';
import {
  loadVoiceOutputEnabled,
  saveVoiceOutputEnabled,
} from '@/utils/voice-output-preference';

/**
 * Persistent "Voice Output / TTS" setting.
 *
 * NOTE: this is distinct from the quick playback mute (`audioManager`/voiceMuted).
 * Turning Voice Output OFF tells the BACKEND to skip TTS synthesis entirely
 * (no ElevenLabs request / no credits consumed), while the quick mute still
 * allows the backend to generate audio. Both feed the same frontend text-only
 * lifecycle so nothing breaks either way.
 */
export const useVoiceOutput = () => {
  const { sendMessage } = useWebSocket();
  const [voiceOutputEnabled, setVoiceOutputEnabledState] = useState<boolean>(
    loadVoiceOutputEnabled,
  );

  const setVoiceOutputEnabled = useCallback((enabled: boolean) => {
    saveVoiceOutputEnabled(enabled);
    setVoiceOutputEnabledState(enabled);
    // Reflect into the shared audio manager so any already-streamed audio is
    // skipped while OFF (the per-segment gate). On the OFF transition the flag
    // setter also stops the currently-playing audio + lip sync immediately.
    audioManager.setVoiceOutputEnabled(enabled);
    // Inform the backend so it stops/starts audio synthesis.
    sendMessage({ type: 'voice-output-toggle', enabled });
    // Turning OFF while a response is streaming: clear any pending queued
    // audio safely (same primitive the interruption path uses).
    if (!enabled) {
      audioTaskQueue.clearQueue();
    }
  }, [sendMessage]);

  const syncVoiceOutputToBackend = useCallback(() => {
    sendMessage({ type: 'voice-output-toggle', enabled: voiceOutputEnabled });
  }, [sendMessage, voiceOutputEnabled]);

  return {
    voiceOutputEnabled,
    setVoiceOutputEnabled,
    syncVoiceOutputToBackend,
  };
};