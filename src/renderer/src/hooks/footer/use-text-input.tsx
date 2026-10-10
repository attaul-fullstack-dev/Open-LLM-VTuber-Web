import { useRef, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useWebSocket } from '@/context/websocket-context';
import { useAiState } from '@/context/ai-state-context';
import { useInterrupt } from '@/components/canvas/live2d';
import { useChatHistory } from '@/context/chat-history-context';
import { useVAD } from '@/context/vad-context';
import { useMediaCapture } from '@/hooks/utils/use-media-capture';
import { startChatLatency } from '@/utils/chat-latency';
import { getUserTimezone } from '@/utils/user-timezone';
import { useAvatarActivityState } from '@/context/avatar-activity-context';
import { saveDraft, loadDraft, clearDraft, draftKey, resolvePostSendDraft } from '@/utils/composer-draft';
import { toaster } from '@/components/ui/toaster';
import {
  AttachmentEntry,
  MAX_ATTACHMENTS_TOTAL_BYTES,
  loadAttachmentEntries,
  mergeAttachments,
  removeAttachment as removeAttachmentEntry,
  validateAttachmentFile,
} from '@/utils/attachments';

function sessionDraftStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

export function useTextInput() {
  const { t } = useTranslation();
  const [inputText, setInputText] = useState('');
  // Multi-file attachments. uploadedRef is the synchronous mirror of the
  // state below: async FileReader completions and the send snapshot read
  // the ref so rapid overlapping selections can never overwrite each other.
  const [uploadedImages, setUploadedImages] = useState<AttachmentEntry[]>([]);
  const uploadedRef = useRef<AttachmentEntry[]>([]);
  // Serializes attachment appends so two selections finishing out of order
  // compose instead of racing (no lost entries, one toast per refusal).
  const appendChainRef = useRef<Promise<void>>(Promise.resolve());

  const syncAttachments = (next: AttachmentEntry[]) => {
    uploadedRef.current = next;
    setUploadedImages(next);
  };

  const removeAttachment = (id: string) => {
    syncAttachments(removeAttachmentEntry(uploadedRef.current, id));
  };
  const [isComposing, setIsComposing] = useState(false);
  const isSendingRef = useRef(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const wsContext = useWebSocket();
  const { aiState } = useAiState();
  const { interrupt } = useInterrupt();
  const { appendHumanMessage, currentHistoryUid } = useChatHistory();
  const { stopMic, autoStopMic } = useVAD();
  const { captureAllMedia } = useMediaCapture();
  const { markUserActivity } = useAvatarActivityState();
  const key = draftKey(currentHistoryUid);

  // Restore a draft that survived reconnect / history reload / remount.
  // Runs on mount and whenever the conversation scope changes.
  useEffect(() => {
    const restored = loadDraft(sessionDraftStorage(), key);
    if (restored) {
      setInputText(restored);
      if (inputRef.current) inputRef.current.value = restored;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputText(e.target.value);
    // Persist every keystroke; cleared only on successful send.
    saveDraft(sessionDraftStorage(), key, e.target.value);
  };

  const handleSend = async () => {
    // On some Android keyboards the displayed textarea value can be one
    // render behind React state at the instant the send button is tapped.
    // Read the native element as a fallback so a visible draft is never lost.
    const text = inputText.trim() || inputRef.current?.value.trim() || '';
    // Snapshot attachments synchronously: files picked during the media
    // capture await below belong to the NEXT message, never this one.
    const outgoingAttachments = uploadedRef.current;
    if (
      (!text && outgoingAttachments.length === 0)
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

      // Final aggregate guard (selection-time enforcement should already
      // guarantee this; never silently drop here, refuse loudly instead).
      const totalBytes = outgoingAttachments.reduce((sum, e) => sum + e.dataBytes, 0);
      if (totalBytes > MAX_ATTACHMENTS_TOTAL_BYTES) {
        toaster.create({
          title: t('error.attachmentSendBlocked'),
          type: 'error',
          duration: 3000,
        });
        return;
      }

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
        // Session identity for the reconnect race: lets the backend adopt
        // the active history instead of minting a new session when this
        // send lands before fetch-and-set-history completes.
        history_uid: currentHistoryUid,
        images: [
          ...capturedImages,
          // name/size travel for backend error messages and future
          // metadata; the model pipeline only consumes source/data/mime_type.
          ...outgoingAttachments.map((entry) => ({
            source: entry.source,
            data: entry.data,
            mime_type: entry.mimeType,
            name: entry.name,
            size: entry.size,
          })),
        ],
        request_id: timing.requestId,
        client_user_send_ms: timing.clientUserSendMs,
        timezone: getUserTimezone(),
      });
      // Never render a phantom user message. If the socket dropped, keep the
      // draft and attachments intact so the user can resend after reconnect.
      if (!sent) return;

      markUserActivity();
      appendHumanMessage(messageText, timing.requestId);
      if (autoStopMic) stopMic();
      // Keystrokes typed during the media-capture await were never sent;
      // resolvePostSendDraft keeps them instead of wiping unsent input.
      const postSend = resolvePostSendDraft(
        messageText,
        inputRef.current?.value,
      );
      if (postSend.action === 'keep') {
        setInputText(postSend.text);
        if (inputRef.current) inputRef.current.value = postSend.text;
        saveDraft(sessionDraftStorage(), key, postSend.text);
      } else {
        setInputText('');
        if (inputRef.current) inputRef.current.value = '';
        syncAttachments([]);
        // The message left the building: the persisted draft is stale now.
        // This is the ONLY place the draft is cleared — never on reconnect,
        // history reload, remount, or streaming events.
        clearDraft(sessionDraftStorage(), key);
      }
    } finally {
      isSendingRef.current = false;
    }
  };

  const handleFileSelect = async (files: FileList | null) => {
    if (!files?.length) return;
    // Pre-read gate per file: invalid files are reported and skipped
    // individually, never silently dropped, never blocking their siblings.
    const candidates: File[] = [];
    for (const file of Array.from(files)) {
      const verdict = validateAttachmentFile(file);
      if (!verdict.ok) {
        toaster.create({
          title: t(
            verdict.code === 'too-large'
              ? 'error.attachmentTooLarge'
              : 'error.attachmentNotImage',
            { name: file.name || 'image' },
          ),
          type: 'error',
          duration: 3000,
        });
        continue;
      }
      candidates.push(file);
    }
    if (candidates.length === 0) return;
    // Per-file isolation: one unreadable file must not discard the rest.
    const { loaded, failed } = await loadAttachmentEntries(candidates);
    for (const failure of failed) {
      toaster.create({
        title: t('error.attachmentReadFailed', { name: failure.name }),
        type: 'error',
        duration: 3000,
      });
    }
    if (loaded.length === 0) return;
    // Serialized append: overlapping selections compose via the ref mirror.
    // A prior rejection must never wedge the chain, so recover first.
    appendChainRef.current = appendChainRef.current
      .catch(() => {})
      .then(() => {
        const result = mergeAttachments(uploadedRef.current, loaded);
        syncAttachments(result.merged);
        for (const dropped of result.droppedByCount) {
          toaster.create({
            title: t('error.attachmentLimitReached', { name: dropped.name }),
            type: 'error',
            duration: 3000,
          });
        }
        for (const dropped of result.droppedByTotal) {
          toaster.create({
            title: t('error.attachmentTotalTooLarge', { name: dropped.name }),
            type: 'error',
            duration: 3000,
          });
        }
      });
    await appendChainRef.current;
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
    removeAttachment,
    attachments: uploadedImages,
    attachmentCount: uploadedImages.length,
    inputRef,
    handleKeyPress,
    handleCompositionStart,
    handleCompositionEnd,
  };
}
