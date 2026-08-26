import { useState } from 'react';
import { useWebSocket } from '@/context/websocket-context';
import { useAiState } from '@/context/ai-state-context';
import { useInterrupt } from '@/components/canvas/live2d';
import { useChatHistory } from '@/context/chat-history-context';
import { useVAD } from '@/context/vad-context';
import { useMediaCapture } from '@/hooks/utils/use-media-capture';

export function useTextInput() {
  const [inputText, setInputText] = useState('');
  const [uploadedImages, setUploadedImages] = useState<Array<{
    source: 'upload'; data: string; mime_type: string;
  }>>([]);
  const [isComposing, setIsComposing] = useState(false);
  const wsContext = useWebSocket();
  const { aiState } = useAiState();
  const { interrupt } = useInterrupt();
  const { appendHumanMessage } = useChatHistory();
  const { stopMic, autoStopMic } = useVAD();
  const { captureAllMedia } = useMediaCapture();

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputText(e.target.value);
  };

  const handleSend = async () => {
    if ((!inputText.trim() && uploadedImages.length === 0) || !wsContext) return;
    if (aiState === 'thinking-speaking') {
      interrupt();
    }

    const capturedImages = await captureAllMedia();
    const images = [...capturedImages, ...uploadedImages];
    const text = inputText.trim() || 'Describe this image.';

    appendHumanMessage(text);
    wsContext.sendMessage({
      type: 'text-input',
      text,
      images,
    });

    if (autoStopMic) stopMic();
    setInputText('');
    setUploadedImages([]);
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
    handleKeyPress,
    handleCompositionStart,
    handleCompositionEnd,
  };
}
