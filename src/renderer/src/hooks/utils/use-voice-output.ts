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
    // Inform the backend so it starts/stops audio synthesis.
    sendMessage({ type: 'voice-output-toggle', enabled });
    // Turning OFF while audio is playing: stop current playback and clear any
    // pending queued audio safely (same primitives the interruption path uses).
    if (!enabled) {
      audioTaskQueue.clearQueue();
      audioManager.stopCurrentAudioAndLipSync();
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