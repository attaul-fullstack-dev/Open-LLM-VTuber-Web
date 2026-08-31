/**
 * Pure persistence helpers for the "Voice Output (TTS)" preference.
 *
 * Kept free of React so it can be unit-tested directly and shared by the
 * settings hook (useVoiceOutput) and the reconnect sync in WebSocketHandler.
 *
 * This is distinct from the quick playback mute (`audioManager`/voiceMuted).
 * The saved value controls whether the BACKEND synthesizes audio at all.
 */
export const VOICE_OUTPUT_ENABLED_KEY = 'voiceOutputEnabled';

// Default is ON for existing users unless a saved setting says otherwise.
export function loadVoiceOutputEnabled(): boolean {
  try {
    const item = window.localStorage.getItem(VOICE_OUTPUT_ENABLED_KEY);
    if (item === null) return true;
    return item !== 'false';
  } catch (error) {
    console.error('Error reading voice output enabled:', error);
    return true;
  }
}

export function saveVoiceOutputEnabled(enabled: boolean): void {
  try {
    window.localStorage.setItem(VOICE_OUTPUT_ENABLED_KEY, String(enabled));
  } catch (error) {
    console.error('Error saving voice output enabled:', error);
  }
}