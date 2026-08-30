import { useRef, useState } from 'react';
import { useWebSocket } from '@/context/websocket-context';
import { useAiState } from '@/context/ai-state-context';
import { useInterrupt } from '@/components/canvas/live2d';
import { useChatHistory } from '@/context/chat-history-context';
import { useVAD } from '@/context/vad-context';
import { useMediaCapture } from '@/hooks/utils/use-media-capture';
import { startChatLatency } from '@/utils/chat-latency';
import { useAvatarActivityState } from '@/context/avatar-activity-context';

export function useTextInput() {
  const [inputText, setInputText] = useState('');
  const [uploadedImages, setUploadedImages] = useState<Array<{
    source: 'upload'; data: string; mime_type: string;
  }>>([]);
  const [isComposing, setIsComposing] = useState(false);
  const isSendingRef = useRef(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const wsContext = useWebSocket();
  const { aiState } = useAiState();
  const { interrupt } = useInterrupt();
  const { appendHumanMessage } = useChatHistory();
  const { stopMic, autoStopMic } = useVAD();
  const { captureAllMedia } = useMediaCapture();
  const { markUserActivity } = useAvatarActivityState();

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputText(e.target.value);
  };

  const handleSend = async () => {
    // On some Android keyboards the displayed textarea value can be one
    // render behind React state at the instant the send button is tapped.
    // Read the native element as a fallback so a visible draft is never lost.
    const text = inputText.trim() || inputRef.current?.value.trim() || '';
    if (
      (!text && uploadedImages.length === 0)
      || !wsContext
      || isSendingRef.current
    ) return;
    if (aiState === 'thinking-speaking') {
      interrupt();
    }

    isSendingRef.current = true;
    // Everything after this point is inside try/finally so the send lock can
    // never stay stuck: an unexpected throw (e.g. startChatLatency outside a
    // secure context) would otherwise make every later send a silent no-op.
    try {
      const timing = startChatLatency();
      const messageText = text || 'Describe this image.';

      // A camera or screen track can stall on some mobile browsers. The text
      // message must remain sendable even when an optional frame cannot be read.
      let capturedImages: Array<{
        source: 'camera' | 'screen'; data: string; mime_type: string;
      }> = [];
      try {
        capturedImages = await Promise.race([
          captureAllMedia(),
          new Promise<Array<{
            source: 'camera' | 'screen'; data: string; mime_type: string;
          }>>((resolve) => {
            window.setTimeout(() => resolve([]), 1200);
          }),
        ]);
      } catch (error) {
        console.warn('Optional media capture failed; sending text without it.', error);
      }
      const sent = wsContext.sendMessage({
        type: 'text-input',
        text: messageText,
        images: [...capturedImages, ...uploadedImages],
        request_id: timing.requestId,
        client_user_send_ms: timing.clientUserSendMs,
      });
      // Never render a phantom user message. If the socket dropped, keep the
      // draft and attachments intact so the user can resend after reconnect.
      if (!sent) return;

      markUserActivity();
      appendHumanMessage(messageText);
      if (autoStopMic) stopMic();
      setInputText('');
      if (inputRef.current) inputRef.current.value = '';
      setUploadedImages([]);
    } finally {
      isSendingRef.current = false;
    }
  };

  const handleFileSelect = async (files: FileList | null) => {
    if (!files?.length) return;
    const imageFiles = Array.from(files).filter((file) => file.type.startsWith('image/'));
    const loaded = await Promise.all(imageFiles.map((file) => new Promise<{
      source: 'upload'; data: string; mime_type: string;
    }>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve({
        source: 'upload',
        data: String(reader.result),
        mime_type: file.type || 'image/jpeg',
      });
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    })));
    setUploadedImages(loaded);
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (isComposing) return;

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleCompositionStart = () => setIsComposing(true);
  const handleCompositionEnd = () => setIsComposing(false);

  return {
    inputText,
    setInputText: handleInputChange,
    handleSend,
    handleFileSelect,
    attachmentCount: uploadedImages.length,
    inputRef,
    handleKeyPress,
    handleCompositionStart,
    handleCompositionEnd,
  };
}
