import { audioManager } from './audio-manager';
import { audioTaskQueue } from './task-queue';
import {
  loadVoiceOutputEnabled,
  saveVoiceOutputEnabled,
} from './voice-output-preference';

export type SendMessageFn = (data: { type: string; [key: string]: any }) => void;

/**
 * Authoritative client store for the "Voice Output (TTS)" master setting.
 *
 * Coordinates between:
 * 1. The footer quick toggle button (ComposerBar)
 * 2. The Sidebar Settings -> General toggle switch
 * 3. The backend WebSocket session (voice-output-toggle and voice-output-state)
 * 4. AudioManager & AudioTaskQueue playback gates and queue clearing
 */
export class VoiceOutputStore {
  private enabled: boolean;
  private backendConfirmed: boolean | null = null;
  private listeners: Set<() => void> = new Set();
  private hasSyncedWithBackend: boolean = false;
  private lastSendMessageFn: SendMessageFn | null = null;

  constructor() {
    this.enabled = loadVoiceOutputEnabled();
    // Synchronize initial audioManager state immediately on store creation
    audioManager.setVoiceOutputEnabled(this.enabled);
    audioManager.setMuted(!this.enabled);
  }

  getSnapshot = (): boolean => {
    return this.enabled;
  };

  getBackendConfirmedSnapshot = (): boolean | null => {
    return this.backendConfirmed;
  };

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private notify() {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (err) {
        console.error('[VoiceOutputStore] Listener error:', err);
      }
    }
  }

  /**
   * Set voice output enabled state.
   * Dispatches change to persistence, audioManager, audioTaskQueue, and WebSocket.
   */
  setVoiceOutputEnabled(enabled: boolean, sendMessage?: SendMessageFn): void {
    if (sendMessage) {
      this.lastSendMessageFn = sendMessage;
    }
    if (this.enabled === enabled && this.backendConfirmed === enabled) {
      return;
    }

    this.enabled = enabled;
    saveVoiceOutputEnabled(enabled);

    // Synchronize AudioManager master flag and quick mute safeguard
    audioManager.setVoiceOutputEnabled(enabled);
    audioManager.setMuted(!enabled);

    // Turning voice OFF: clear pending queues and cancel active playback
    if (!enabled) {
      audioManager.stopCurrentAudioAndLipSync();
      audioTaskQueue.clearQueue();
    }

    // Mark as pending confirmation until backend confirms
    this.backendConfirmed = null;

    // Dispatch WebSocket message to backend
    if (sendMessage) {
      try {
        sendMessage({ type: 'voice-output-toggle', enabled });
      } catch (err) {
        console.error('[VoiceOutputStore] Failed to send voice-output-toggle:', err);
      }
    }

    this.notify();
  }

  /**
   * Handle backend confirmation message {"type": "voice-output-state", "enabled": boolean}
   */
  onBackendConfirmed(confirmedEnabled: boolean, sendMessage?: SendMessageFn): void {
    const sender = sendMessage || this.lastSendMessageFn;

    // Stale Handshake Safeguard:
    // If the local preference is OFF (!this.enabled) and we have not yet established
    // a synchronized session on this socket, do NOT allow an unprompted "enabled: true"
    // from a stale/uninitialized handshake to overwrite the user's OFF preference.
    if (!this.hasSyncedWithBackend && !this.enabled && confirmedEnabled) {
      console.warn(
        '[VoiceOutputStore] Rejecting stale initial backend handshake (enabled=true) while persisted preference is OFF; re-asserting OFF to backend'
      );
      if (sender) {
        try {
          sender({ type: 'voice-output-toggle', enabled: false });
        } catch (err) {
          console.error('[VoiceOutputStore] Failed to re-assert voice-output-toggle:', err);
        }
      }
      return;
    }

    this.hasSyncedWithBackend = true;
    this.backendConfirmed = confirmedEnabled;

    // If backend state contradicts optimistic local state, reconcile
    if (this.enabled !== confirmedEnabled) {
      this.enabled = confirmedEnabled;
      saveVoiceOutputEnabled(confirmedEnabled);
      audioManager.setVoiceOutputEnabled(confirmedEnabled);
      audioManager.setMuted(!confirmedEnabled);
      if (!confirmedEnabled) {
        audioManager.stopCurrentAudioAndLipSync();
        audioTaskQueue.clearQueue();
      }
    }

    this.notify();
  }

  /**
   * Re-send current persisted state to backend on WebSocket connect / reconnect.
   */
  syncToBackend(sendMessage: SendMessageFn): void {
    this.lastSendMessageFn = sendMessage;
    this.hasSyncedWithBackend = false;
    try {
      sendMessage({ type: 'voice-output-toggle', enabled: this.enabled });
    } catch (err) {
      console.error('[VoiceOutputStore] Failed to sync to backend:', err);
    }
  }

  resetSyncStatus(): void {
    this.hasSyncedWithBackend = false;
  }
}

export const voiceOutputStore = new VoiceOutputStore();
