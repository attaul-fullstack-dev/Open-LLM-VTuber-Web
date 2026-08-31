/**
 * Global audio manager for handling audio playback and interruption
 * This ensures all components share the same audio reference
 */
class AudioManager {
  private currentAudio: HTMLAudioElement | null = null;
  private currentModel: any | null = null;
  private muted = typeof window !== 'undefined'
    && window.localStorage.getItem('voiceMuted') === 'true';
  // Voice Output (TTS) master flag: distinct from `muted` (quick speaker).
  // When false, playback is skipped for any audio (including already-streamed
  // segments) AND the backend stops synthesizing. Defaults to enabled.
  private voiceOutputEnabled = true;

  setMuted(muted: boolean) {
    this.muted = muted;
    window.localStorage.setItem('voiceMuted', String(muted));
    if (muted) {
      this.stopCurrentAudioAndLipSync();
    }
  }

  isMuted(): boolean {
    return this.muted;
  }

  setVoiceOutputEnabled(enabled: boolean) {
    this.voiceOutputEnabled = enabled;
    if (!enabled) {
      // VOICE-OFF is stronger than mute: also stop whatever is currently
      // playing and clear pending lip-sync / playback state.
      this.stopCurrentAudioAndLipSync();
    }
  }

  isVoiceOutputEnabled(): boolean {
    return this.voiceOutputEnabled;
  }

  /**
   * Whether a segment should skip audible playback. True when the quick
   * speaker mute is on OR Voice Output (TTS) is off. This gate is re-checked
   * per segment, so already-generated queued audio never plays after toggle.
   */
  shouldSkipPlayback(): boolean {
    return this.muted || !this.voiceOutputEnabled;
  }

  /**
   * Set the current playing audio
   */
  setCurrentAudio(audio: HTMLAudioElement, model: any) {
    this.currentAudio = audio;
    this.currentModel = model;
  }

  /**
   * Stop current audio playback and lip sync
   */
  stopCurrentAudioAndLipSync() {
    if (this.currentAudio) {
      console.log('[AudioManager] Stopping current audio and lip sync');
      const audio = this.currentAudio;
      
      // Stop audio playback
      audio.pause();
      audio.src = '';
      audio.load();

      // Stop Live2D lip sync
      const model = this.currentModel;
      if (model && model._wavFileHandler) {
        try {
          // Release PCM data to stop lip sync calculation in update()
          model._wavFileHandler.releasePcmData();
          console.log('[AudioManager] Called _wavFileHandler.releasePcmData()');

          // Additional reset of state variables as fallback
          model._wavFileHandler._lastRms = 0.0;
          model._wavFileHandler._sampleOffset = 0;
          model._wavFileHandler._userTimeSeconds = 0.0;
          console.log('[AudioManager] Also reset _lastRms, _sampleOffset, _userTimeSeconds as fallback');
        } catch (e) {
          console.error('[AudioManager] Error stopping/resetting wavFileHandler:', e);
        }
      } else if (model) {
        console.warn('[AudioManager] Current model does not have _wavFileHandler to stop/reset.');
      } else {
        console.log('[AudioManager] No associated model found to stop lip sync.');
      }

      // Clear references
      this.currentAudio = null;
      this.currentModel = null;
    } else {
      console.log('[AudioManager] No current audio playing to stop.');
    }
  }

  /**
   * Clear the current audio reference (called when audio ends naturally)
   */
  clearCurrentAudio(audio: HTMLAudioElement) {
    if (this.currentAudio === audio) {
      this.currentAudio = null;
      this.currentModel = null;
    }
  }

  /**
   * Check if there's currently playing audio
   */
  hasCurrentAudio(): boolean {
    return this.currentAudio !== null;
  }
}

// Export singleton instance
export const audioManager = new AudioManager();
