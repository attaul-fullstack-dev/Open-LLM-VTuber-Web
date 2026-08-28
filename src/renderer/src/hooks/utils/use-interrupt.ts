import { useAiState } from '@/context/ai-state-context';
import { useWebSocket } from '@/context/websocket-context';
import { useChatHistory } from '@/context/chat-history-context';
import { audioTaskQueue } from '@/utils/task-queue';
import { useSubtitle } from '@/context/subtitle-context';
import { useAudioTask } from './use-audio-task';
import { subtitlePlaybackCoordinator } from '@/utils/subtitle-playback';
import { useAvatarActivityState } from '@/context/avatar-activity-context';

export const useInterrupt = () => {
  const { aiState, setAiState } = useAiState();
  const { sendMessage } = useWebSocket();
  const { fullResponse, clearResponse } = useChatHistory();
  // const { currentModel } = useLive2DModel();
  const { setSubtitleText } = useSubtitle();
  const { stopCurrentAudioAndLipSync } = useAudioTask();
  const { markUserActivity } = useAvatarActivityState();

  const interrupt = (sendSignal = true) => {
    if (aiState !== 'thinking-speaking') return;
    console.log('Interrupting conversation chain');

    // A local interruption is meaningful direct user activity. Forwarded
    // interruption signals from another client must not reset this runtime.
    if (sendSignal) markUserActivity();

    stopCurrentAudioAndLipSync();

    subtitlePlaybackCoordinator.cancelResponse();
    audioTaskQueue.clearQueue();

    setAiState('interrupted');

    if (sendSignal) {
      sendMessage({
        type: 'interrupt-signal',
        text: fullResponse,
      });
    }

    clearResponse();

    // No cancelled segment may remain visible or become visible later.
    setSubtitleText('');
    console.log('Interrupted!');
  };

  return { interrupt };
};
