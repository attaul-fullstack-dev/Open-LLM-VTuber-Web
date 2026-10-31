/* eslint-disable no-sparse-arrays */
/* eslint-disable react-hooks/exhaustive-deps */
// eslint-disable-next-line object-curly-newline
import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { wsService, MessageEvent } from '@/services/websocket-service';
import {
  WebSocketContext, HistoryInfo, defaultWsUrl, defaultBaseUrl,
} from '@/context/websocket-context';
import { ModelInfo, useLive2DConfig } from '@/context/live2d-config-context';
import { useSubtitle } from '@/context/subtitle-context';
import { audioTaskQueue } from '@/utils/task-queue';
import { useAudioTask } from '@/components/canvas/live2d';
import {
  flushPendingSegmentTexts,
  noteDiscardedAudioFrame,
  noteIncomingAudioFrame,
} from '@/hooks/utils/use-audio-task';
import { useBgUrl } from '@/context/bgurl-context';
import { useConfig } from '@/context/character-config-context';
import { useChatHistory } from '@/context/chat-history-context';
import { toaster } from '@/components/ui/toaster';
import { logWsDiag } from '@/utils/ws-diagnostics';
import { audioFrameAck, buildMessageAck, type AckStatus } from '@/utils/message-ack';
import {
  createAckOutbox,
  queueAndSendAck,
  requeueFailedAck,
} from '@/utils/ack-outbox';
import { stableClientRef } from '@/utils/client-identity';
import { useVAD } from '@/context/vad-context';
import { AiState, useAiState } from "@/context/ai-state-context";
import { useLocalStorage } from '@/hooks/utils/use-local-storage';
import { useGroup } from '@/context/group-context';
import { useInterrupt } from '@/hooks/utils/use-interrupt';
import { useBrowser } from '@/context/browser-context';
import { markBackendLatencyEvent, markFrontendPayload } from '@/utils/chat-latency';
import {
  clearLastHistoryUid,
  decideHistoryResume,
  getLastHistoryUid,
  setLastHistoryUid,
  type ResumableSession,
} from '@/utils/history-storage';
import { parseContinuationEvent } from '@/utils/history-continuation';
import { subtitlePlaybackCoordinator } from '@/utils/subtitle-playback';
import { readPlaybackIdentity } from '@/utils/audio-playback-outcome';
import { loadVoiceOutputEnabled } from '@/utils/voice-output-preference';
import { useLifeState } from '@/context/life-state-context';
import { toLifeSnapshot } from '@/utils/life-state-sync';
import { getUserTimezone } from '@/utils/user-timezone';
import {
  resolveAttachmentDeleteOutcome,
} from '@/utils/attachment-memory-status';
import type {
  AttachmentRemainingSource,
} from '@/utils/attachment-memory-status';

/**
 * Send the receipt for one server frame (Stage 2 delivery protocol).
 *
 * Module-scoped on purpose: an ACK is protocol plumbing, not React state, and
 * it must never re-render anything. Nothing is sent for a frame that carries
 * no msg_id/attempt (a server that predates the protocol keeps its legacy
 * behaviour) or on a closed socket (there is nobody to tell, and the socket's
 * own not-open toast would fire on every frame).
 */
/**
 * Receipts that could not be handed to a live socket. Durable across a
 * disconnect (and a reload), drained once per reconnection.
 *
 * Storage is injected at module scope and guarded: a renderer without
 * localStorage still works, it just cannot promise durability.
 */
const ackOutbox = createAckOutbox(
  (() => {
    try {
      return typeof window === 'undefined' ? null : window.localStorage;
    } catch {
      return null;
    }
  })(),
);

function sendFrameAck(
  frame: MessageEvent | null | undefined,
  status: AckStatus,
  reason?: string,
): void {
  if (!frame || frame.forwarded) return;
  const ack = buildMessageAck(frame, status, reason);
  if (!ack) return;
  // Write-ahead: persist the receipt BEFORE the socket gets it. A send that
  // the transport accepts can still be lost before the backend records it;
  // only the durable copy survives that window and can be replayed after a
  // reconnect. Never a receipt we did not earn: the status still comes from
  // what actually happened to this frame.
  const delivery = queueAndSendAck(
    ack,
    ackOutbox,
    () => wsService.getCurrentState() === 'OPEN' && wsService.sendMessage(ack),
  );
  if (!delivery.persisted) {
    console.warn('Message receipt queued in memory only; storage refused it');
  }
  logWsDiag(
    delivery.sent ? 'MESSAGE_ACK' : 'MESSAGE_ACK_QUEUED',
    wsService.getConnectionId(),
    `status=${ack.status} seq=${ack.seq ?? '-'} final=${ack.final === true} `
      + `persisted=${delivery.persisted}`,
  );
}

function WebSocketHandler({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const [wsState, setWsState] = useState<string>('CLOSED');
  const [wsUrl, setWsUrl] = useLocalStorage<string>('wsUrl', defaultWsUrl);
  const [baseUrl, setBaseUrl] = useLocalStorage<string>('baseUrl', defaultBaseUrl);
  const {
    aiState, setAiState, backendSynthComplete, setBackendSynthComplete,
    setBackendSynthCompleteIdentity, setFirstTokenAt,
  } = useAiState();
  const { setModelInfo } = useLive2DConfig();
  const { setSubtitleText, startSubtitleResponse } = useSubtitle();
  const {
    clearResponse, setForceNewMessage, appendHumanMessage, appendOrUpdateToolCallMessage,
    applyHistoryData, noteChainStart, appendFlushedSegments, applyCanonicalFinalToBubble,
  } = useChatHistory();
  const { addAudioTask } = useAudioTask();
  const bgUrlContext = useBgUrl();
  const { confUid, setConfName, setConfUid, setConfigFiles } = useConfig();
  const [pendingModelInfo, setPendingModelInfo] = useState<ModelInfo | undefined>(undefined);
  const { setSelfUid, setGroupMembers, setIsOwner } = useGroup();
  const { startMic, stopMic, autoStartMicOnConvEnd } = useVAD();
  const autoStartMicOnConvEndRef = useRef(autoStartMicOnConvEnd);
  const activeConfUidRef = useRef('');
  const { interrupt } = useInterrupt();
  const { setBrowserViewData } = useBrowser();
  const { enabled: lifeStateEnabled, setSnapshot: setLifeSnapshot } = useLifeState();
  const lifeStateEnabledRef = useRef(lifeStateEnabled);

  useEffect(() => {
    lifeStateEnabledRef.current = lifeStateEnabled;
  }, [lifeStateEnabled]);

  useEffect(() => {
    autoStartMicOnConvEndRef.current = autoStartMicOnConvEnd;
  }, [autoStartMicOnConvEnd]);

  useEffect(() => {
    if (pendingModelInfo && confUid) {
      setModelInfo(pendingModelInfo);
      setPendingModelInfo(undefined);
    }
  }, [pendingModelInfo, setModelInfo, confUid]);

  const {
    setCurrentHistoryUid, setHistoryList,
  } = useChatHistory();

  // Last announced (connection, history) pair, so `client-hello` is sent once
  // per connection and again when the visible history changes.
  const helloSignatureRef = useRef('');

  /**
   * Announce the delivery protocol for the connection + history the user is
   * actually looking at, then replay receipts that never reached the previous
   * connection (Stage 3).
   *
   * Sent only after the client's bubble list is authoritative, so a recovery
   * resend can be matched to an existing bubble by msg_id instead of being
   * discarded as "no bubble". A receipt is never invented here: the outbox
   * only contains receipts that were really produced for frames this client
   * actually took (or really dropped).
   */
  const announceDeliveryProtocol = useCallback((historyUid?: string | null) => {
    const signature = `${wsService.getConnectionId()}|${historyUid ?? ''}`;
    if (helloSignatureRef.current === signature) return;
    const clientRef = stableClientRef();
    const hello: Record<string, unknown> = {
      type: 'client-hello',
      protocol: 1,
      ack: true,
    };
    if (clientRef) hello.client_ref = clientRef;
    if (historyUid) hello.history_uid = historyUid;
    if (!wsService.sendMessage(hello)) {
      // The socket died before the handshake finished; the next connection must
      // announce itself again.
      helloSignatureRef.current = '';
      return;
    }
    helloSignatureRef.current = signature;
    // Ordered after the hello: the backend must know this client's instance id
    // before it judges the receipts' ownership.
    const flushed = ackOutbox.flush((ack) => wsService.sendMessage(ack));
    if (flushed.sent || flushed.remaining || !flushed.persisted) {
      logWsDiag(
        'MESSAGE_ACK_OUTBOX_FLUSH',
        wsService.getConnectionId(),
        `sent=${flushed.sent} remaining=${flushed.remaining} persisted=${flushed.persisted}`,
      );
    }
  }, []);

  const handleControlMessage = useCallback((controlText: string, message?: MessageEvent) => {
    switch (controlText) {
      case 'start-mic':
        console.log('Starting microphone...');
        startMic();
        break;
      case 'stop-mic':
        console.log('Stopping microphone...');
        stopMic();
        break;
      case 'conversation-turn-queued':
        // Backend-accepted turn waiting behind a detached in-flight turn on
        // the same history. Thinking is truthful here (the turn WILL run);
        // unlike chain-start this clears nothing and starts no new bubble.
        logWsDiag('CHAIN_QUEUED', wsService.getConnectionId());
        setAiState('thinking-speaking');
        setFirstTokenAt(null);
        break;
      case 'conversation-chain-start':
        logWsDiag('CHAIN_START', wsService.getConnectionId());
        // Preserve-before-clear, gated by turn finality (interrupt fix):
        // unplayed queued sentences are flushed through the canonical gate
        // — only segments of finalized turns (ai-final received) may still
        // join the live UI, where the finalized guard turns them into
        // verified no-ops. Segments of interrupted/cancelled turns are
        // drained and dropped so a chain-start can never invent live text
        // the canonical history lacks. Text only; the audio tasks themselves
        // are still cleared below (no replay). Runs before
        // setForceNewMessage so gated healing merges into the finishing
        // turn's bubble instead of opening a new one.
        try {
          appendFlushedSegments(flushPendingSegmentTexts());
        } catch {
          // Flush is best-effort; clearing below still proceeds.
        }
        setAiState('thinking-speaking');
        // The turn on this history actually started: older turns there are
        // done or cancelled by construction, so their leftovers retire —
        // except the just-accepted send, kept until the snapshot confirms it.
        noteChainStart(message?.history_uid);
        // A new turn owns the next AI bubble: chunks must never merge into a
        // stale bubble left behind by a resync that raced the previous turn.
        setForceNewMessage(true);
        // The dedicated thinking indicator owns the waiting state now; the
        // subtitle only carries real response text.
        setFirstTokenAt(null);
        audioTaskQueue.clearQueue();
        // Invalidate any late playback event from the previous response.
        subtitlePlaybackCoordinator.startResponse();
        startSubtitleResponse();
        clearResponse();
        break;
      case 'conversation-chain-end':
        logWsDiag('CHAIN_END', wsService.getConnectionId());
        audioTaskQueue.addTask(() => new Promise<void>((resolve) => {
          setAiState((currentState: AiState) => {
            if (currentState === 'thinking-speaking') {
              // Auto start mic if enabled
              if (autoStartMicOnConvEndRef.current) {
                startMic();
              }
              return 'idle';
            }
            return currentState;
          });
          resolve();
        }));
        // LIVE PATH (backend sends {type:'control',text:'conversation-chain-end'}):
        // event-driven Life State refresh, widget visible only, no polling.
        // The user timezone travels with the request so reconnects and
        // fresh sessions still derive time_context locally.
        if (lifeStateEnabledRef.current) {
          wsService.sendMessage({ type: 'fetch-world-state', timezone: getUserTimezone() });
        }
        break;
      default:
        console.warn('Unknown control command:', controlText);
    }
  }, [setAiState, setSubtitleText, clearResponse, setForceNewMessage, noteChainStart, startMic, stopMic, startSubtitleResponse, t, appendFlushedSegments, applyCanonicalFinalToBubble, announceDeliveryProtocol]);

  const handleWebSocketMessage = useCallback((message: MessageEvent) => {
    console.debug('WebSocket event received:', message.type);
    const remainingSourceLabel = (item: AttachmentRemainingSource): string => {
      switch (item.kind) {
        case 'episodic':
          return t('notification.attachmentRemainingEpisodic', { count: item.count });
        case 'transcripts':
          return t('notification.attachmentRemainingTranscripts', { count: item.count });
        case 'summaries':
          return t('notification.attachmentRemainingSummaries', { count: item.count });
        case 'character':
          return t('notification.attachmentRemainingCharacter', { count: item.count });
        case 'world':
          return t('notification.attachmentRemainingWorld', { count: item.count });
        default:
          return '';
      }
    };
    const describeRemainingSources = (remaining: AttachmentRemainingSource[]): string => (
      remaining.map(remainingSourceLabel).filter((label) => label !== '').join(', ')
    );
    switch (message.type) {
      case 'control':
        if (message.text) {
          handleControlMessage(message.text, message);
        }
        break;
      case 'set-model-and-conf':
        setAiState('loading');
        if (message.conf_name) {
          setConfName(message.conf_name);
        }
        if (message.conf_uid) {
          activeConfUidRef.current = message.conf_uid;
          setConfUid(message.conf_uid);
          console.log('confUid', message.conf_uid);
        }
        if (message.client_uid) {
          setSelfUid(message.client_uid);
        }
        // Normalize a valid model before queueing it. Do not mutate the
        // WebSocket payload and never pass an incomplete model into the SDK.
        if (message.model_info?.url) {
          const normalizedModelInfo = {
            ...message.model_info,
            url: message.model_info.url.startsWith("http")
              ? message.model_info.url
              : baseUrl + message.model_info.url,
          };
          setPendingModelInfo(normalizedModelInfo);
        } else {
          console.warn("Ignored Live2D model info without a URL");
        }

        setAiState('idle');
        break;
      case 'full-text':
        if (message.text) {
          setSubtitleText(message.text);
        }
        break;
      case 'ai-final': {
        // Canonical final: the backend persisted this turn's AI row and its
        // text is authoritative. Reconcile the live bubble(s) of that turn
        // to it (idempotent; split parts collapse by turn identity; never
        // creates bubbles, never replays audio). Routed by message type so
        // the canonical text itself can travel in `text`.
        const canonicalId = message.request_id ?? null;
        const canonicalMsgId = message.msg_id ?? null;
        const canonicalText = typeof message.text === 'string' ? message.text : '';
        if ((canonicalId || canonicalMsgId) && canonicalText) {
          logWsDiag('CANONICAL_FINAL', wsService.getConnectionId(), `chars=${canonicalText.length}`);
          const applied = applyCanonicalFinalToBubble(
            canonicalId ?? '',
            canonicalText,
            message.history_uid ?? null,
            canonicalMsgId,
          );
          // Receipt only when the canonical text actually landed in a bubble.
          // Otherwise the frame was discarded (no bubble of this message is
          // open — e.g. another history is showing) and saying "received"
          // would hide that from the backend.
          sendFrameAck(message, applied ? 'received' : 'dropped', applied ? undefined : 'no-bubble');
        } else {
          sendFrameAck(message, 'dropped', 'malformed');
        }
        break;
      }
      case 'latency-event':
        markBackendLatencyEvent(
          message.request_id,
          message.event,
          message.metrics,
        );
        if (message.event === 'first-token') {
          // Raw provider token is available now. Remove the waiting indicator
          // immediately; sentence segmentation/TTS may continue independently.
          setFirstTokenAt(Date.now());
          setSubtitleText('');
        }
        break;
      case 'config-files':
        if (message.configs) {
          setConfigFiles(message.configs);
        }
        break;
      case 'config-switched':
        setAiState('idle');
        setSubtitleText(t('notification.characterLoaded'));

        toaster.create({
          title: t('notification.characterSwitched'),
          type: 'success',
          duration: 2000,
        });

        // setModelInfo(undefined);

        wsService.sendMessage({ type: 'fetch-history-list' });
        break;
      case 'background-files':
        if (message.files) {
          bgUrlContext?.setBackgroundFiles(message.files);
        }
        break;
      case 'audio': {
        markFrontendPayload(
          message.request_id,
          'audio',
          Boolean(message.display_text?.text),
        );
        // Identity is recorded before the discard decision: a turn whose
        // frames are all refused must still be matchable by its completion,
        // and a new turn must reset the previous outcome report.
        const audioPlaybackIdentity = readPlaybackIdentity(message);
        noteIncomingAudioFrame(audioPlaybackIdentity);
        let buffered = false;
        let discardReason: string | undefined;
        if (aiState === 'interrupted' || aiState === 'listening') {
          console.debug('Audio playback intercepted', {
            display_characters: message.display_text?.text?.length || 0,
          });
          // Deliberately discarded: say so, so the backend can retry this
          // message with the SAME msg_id instead of treating it as delivered.
          discardReason = aiState;
          noteDiscardedAudioFrame(audioPlaybackIdentity);
        } else {
          console.debug('Audio payload received', {
            has_actions: Boolean(message.actions),
            display_characters: message.display_text?.text?.length || 0,
          });
          buffered = addAudioTask({
            audioBase64: message.audio || '',
            volumes: message.volumes || [],
            sliceLength: message.slice_length || 0,
            displayText: message.display_text || null,
            expressions: message.actions?.expressions || null,
            emotions: message.actions?.emotions || null,
            forwarded: message.forwarded || false,
            requestId: message.request_id ?? null,
            msgId: message.msg_id ?? null,
            attempt: message.attempt ?? null,
          });
          if (!buffered) {
            discardReason = 'interrupted';
            noteDiscardedAudioFrame(audioPlaybackIdentity);
          }
        }
        const decision = audioFrameAck(buffered, discardReason);
        // "received" here means buffered, never rendered or heard.
        sendFrameAck(message, decision.status, decision.reason);
        break;
      }
      case 'history-data':
        if (message.messages) {
          // Diagnostic-only (BUG B capture): count only, never content.
          logWsDiag(
            'HISTORY_DATA_RECEIVED', wsService.getConnectionId(),
            `count=${message.messages.length}`,
          );
          // Reconcile, never blindly replace: an accepted-but-unpersisted
          // local message survives a resync that raced the turn. The toast
          // below still fires so the resync stays visible.
          //
          // A continuation session also carries the read-only context of the
          // transcript it continues, so a reload/reconnect renders the
          // conversation as continued instead of empty. Ordinary sessions
          // parse to null, which clears any stale banner.
          applyHistoryData(
            message.messages,
            message.history_uid,
            parseContinuationEvent(message as unknown as Record<string, unknown>),
          );
        }
        // Bubbles are authoritative now: announce the protocol (and drain held
        // receipts) so a recovery resend lands in an existing bubble.
        announceDeliveryProtocol(message.history_uid ?? null);
        toaster.create({
          title: t('notification.historyLoaded'),
          type: 'success',
          duration: 2000,
        });
        break;
      case 'new-history-created':
        setAiState('idle');
        setSubtitleText(t('notification.newConversation'));
        window.setTimeout(() => setSubtitleText(''), 1800);
        // No need to open mic here
        if (message.history_uid) {
          // A hand-off (`continued_from`) starts a NEW transcript that carries
          // the previous conversation on. It must not present itself as an
          // empty chat: the bubbles this tab already shows for the source
          // conversation become the read-only context, and only this session's
          // own rows go into `messages`.
          const continuationEvent = parseContinuationEvent(
            message as unknown as Record<string, unknown>,
          );
          logWsDiag(
            'ACTIVE_HISTORY_ID', wsService.getConnectionId(),
            `uid=${message.history_uid} continued=${continuationEvent ? 'yes' : 'no'}`,
          );
          setLastHistoryUid(activeConfUidRef.current, message.history_uid);
          // Applied while the source history is still the displayed one, which
          // is what lets the context be adopted from the screen instead of
          // re-fetched.
          applyHistoryData([], message.history_uid, continuationEvent);
          setCurrentHistoryUid(message.history_uid);
          announceDeliveryProtocol(message.history_uid);
          const newHistory: HistoryInfo = {
            uid: message.history_uid,
            latest_message: null,
            timestamp: new Date().toISOString(),
            ...(continuationEvent ? { continued_from: continuationEvent.from } : {}),
          };
          setHistoryList((prev: HistoryInfo[]) => [newHistory, ...prev]);
          toaster.create({
            title: t('notification.newChatHistory'),
            type: 'success',
            duration: 2000,
          });
        }
        break;
      case 'history-deleted':
        if (message.success && message.history_uid
            && getLastHistoryUid(activeConfUidRef.current) === message.history_uid) {
          clearLastHistoryUid(activeConfUidRef.current);
        }
        toaster.create({
          title: message.success
            ? t('notification.historyDeleteSuccess')
            : t('notification.historyDeleteFail'),
          type: message.success ? 'success' : 'error',
          duration: 2000,
        });
        break;
      case 'relationship-reset':
        toaster.create({
          title: message.success
            ? t('notification.relationshipResetSuccess')
            : t('notification.relationshipResetFail'),
          type: message.success ? 'success' : 'error',
          duration: 2500,
        });
        break;
      case 'compact-result':
        toaster.create({
          title: message.success
            ? t('notification.compactSuccess')
            : t('notification.compactFail'),
          description: message.success ? undefined : (message.error || undefined),
          type: message.success ? 'success' : 'error',
          duration: 2500,
        });
        break;
      case 'history-renamed':
        if (message.success && message.history_uid && message.title) {
          setHistoryList((prev: HistoryInfo[]) => prev.map((history) => (
            history.uid === message.history_uid
              ? { ...history, title: message.title }
              : history
          )));
        }
        toaster.create({
          title: message.success
            ? t('notification.historyRenameSuccess')
            : t('notification.historyRenameFail'),
          type: message.success ? 'success' : 'error',
          duration: 2000,
        });
        break;
      case 'history-auto-titled':
        // Passive auto-title from the backend: update the list silently,
        // no toast (unlike a manual rename).
        if (message.success && message.history_uid && message.title) {
          setHistoryList((prev: HistoryInfo[]) => prev.map((history) => (
            history.uid === message.history_uid
              ? { ...history, title: message.title }
              : history
          )));
        }
        break;
      case 'character-memory':
        // The memory list is consumed by the Agent settings panel.
        break;
      case 'character-memory-deleted':
        toaster.create({
          title: message.success
            ? t('notification.memoryDeleteSuccess')
            : t('notification.memoryDeleteFail'),
          type: message.success ? 'success' : 'error',
          duration: 2000,
        });
        break;
      case 'character-memory-reset':
        toaster.create({
          title: message.success
            ? t('notification.memoryResetSuccess')
            : t('notification.memoryResetFail'),
          type: message.success ? 'success' : 'error',
          duration: 2000,
        });
        break;
      case 'character-state-reset':
        toaster.create({
          title: message.success
            ? t('notification.characterStateResetSuccess')
            : t('notification.characterStateResetFail'),
          type: message.success ? 'success' : 'error',
          duration: 2000,
        });
        break;
      case 'attachment-memories':
        // The attachment list is consumed by the Agent settings panel.
        break;
      case 'attachment-memory-deleted': {
        // The purge object is authoritative: a bare success flag must never
        // be upgraded into a "fully forgotten" claim.
        const outcome = resolveAttachmentDeleteOutcome(message);
        if (outcome.outcome === 'complete') {
          toaster.create({
            title: t('notification.attachmentDeleteComplete'),
            type: 'success',
            duration: 2000,
          });
        } else if (outcome.outcome === 'partial') {
          toaster.create({
            title: t('notification.attachmentDeletePartial'),
            description: describeRemainingSources(outcome.remaining),
            type: 'warning',
            duration: 4000,
          });
        } else if (outcome.outcome === 'legacy-success') {
          toaster.create({
            title: t('notification.attachmentDeleteSuccess'),
            type: 'success',
            duration: 2000,
          });
        } else {
          toaster.create({
            title: t('notification.attachmentDeleteFail'),
            type: 'error',
            duration: 2000,
          });
        }
        break;
      }
      case 'attachment-memories-cleared':
        toaster.create({
          title: t('notification.attachmentsCleared', { count: message.removed ?? 0 }),
          type: 'success',
          duration: 2000,
        });
        break;
      case 'history-list':
        if (message.histories) {
          logWsDiag(
            'HISTORY_LIST_RECEIVED', wsService.getConnectionId(),
            `count=${message.histories.length}`,
          );
          setHistoryList(message.histories);
          const confUidForHistory = activeConfUidRef.current;
          const rememberedUid = getLastHistoryUid(confUidForHistory);
          // Empty hand-off targets the backend vouches for. They are absent
          // from `histories` (they have no rows, so they are not conversations)
          // but a tab that remembers one of these uids must continue IT rather
          // than silently fall back to the source transcript.
          const resumableSessions: ResumableSession[] = Array.isArray(
            message.resumable_sessions,
          ) ? message.resumable_sessions : [];
          const decision = decideHistoryResume(
            message.histories.map((history) => history.uid),
            rememberedUid,
            resumableSessions.map((session) => session.uid),
          );

          if (decision.type === 'resume') {
            logWsDiag(
              'RESYNC_DECISION', wsService.getConnectionId(),
              `type=resume uid=${decision.uid} source=${decision.source}`,
            );
            setLastHistoryUid(confUidForHistory, decision.uid);
            setCurrentHistoryUid(decision.uid);
            if (decision.source === 'continued') {
              // The adopted session has no rows, so the list just received does
              // not contain it. Insert the same shape a live hand-off inserts,
              // so the sidebar shows the active conversation (with its lineage)
              // instead of nothing until the next list refresh. Kept idempotent
              // for a repeated frame.
              const adopted = resumableSessions.find(
                (session) => session.uid === decision.uid,
              );
              setHistoryList((prev: HistoryInfo[]) => (
                prev.some((history) => history.uid === decision.uid)
                  ? prev
                  : [{
                    uid: decision.uid,
                    latest_message: null,
                    timestamp: adopted?.continued_at
                      || adopted?.timestamp
                      || new Date().toISOString(),
                    ...(adopted?.continued_from
                      ? { continued_from: adopted.continued_from }
                      : {}),
                  }, ...prev]
              ));
            }
            wsService.sendMessage({
              type: 'fetch-and-set-history',
              history_uid: decision.uid,
              timezone: getUserTimezone(),
            });
          } else {
            logWsDiag(
              'RESYNC_DECISION', wsService.getConnectionId(),
              'type=create',
            );
            if (rememberedUid) clearLastHistoryUid(confUidForHistory);
            wsService.sendMessage({ type: 'create-new-history', timezone: getUserTimezone() });
          }
        }
        break;
      case 'user-input-transcription':
        console.debug('User transcription received', { length: message.text?.length || 0 });
        if (message.text) {
          appendHumanMessage(message.text);
        }
        break;
      case 'delivery-summary':
        // Recovery state of this client's unsettled messages (Stage 3). The
        // server redelivers on its own; the client only reports what it was
        // told, and never presents an unreadable store as "all settled".
        logWsDiag(
          'DELIVERY_SUMMARY',
          wsService.getConnectionId(),
          `ok=${message.ok !== false} pending=${message.unsettled?.length ?? 0}`,
        );
        if (message.unsettled?.length) {
          console.debug('Recovery summary received', {
            pending: message.unsettled.map((item) => `${item.msg_id}#${item.attempt}`),
            redelivery: message.redelivery === true,
          });
        }
        if (message.ok === false) {
          console.warn('Delivery state unreadable on the backend; recovery is unknown');
        }
        break;
      case 'message-ack-result':
        // The backend could not record our receipt (state store failure).
        // Nothing here may pretend it was accepted; the delivery stays
        // unsettled on the server, which is the truthful outcome.
        if (!message.success) {
          // The backend echoed the validated receipt so it can be replayed.
          // This matters after a reconnect flush, which removes an entry as
          // soon as the socket accepts it: a state-write failure must not
          // silently discard that receipt.
          const requeued = requeueFailedAck(ackOutbox, message.ack);
          console.warn(
            'Message receipt not recorded by backend:',
            message.reason,
            requeued.queued
              ? `requeued (persisted=${requeued.persisted})`
              : 'no valid receipt to requeue',
          );
          logWsDiag(
            'MESSAGE_ACK_NOT_RECORDED',
            wsService.getConnectionId(),
            `reason=${message.reason ?? 'unknown'} requeued=${requeued.queued} persisted=${requeued.persisted}`,
          );
        }
        break;
      case 'error':
        toaster.create({
          title: message.message,
          type: 'error',
          duration: 2000,
        });
        break;
      case 'group-update':
        console.debug('Group update received', { memberCount: message.members?.length || 0 });
        if (message.members) {
          setGroupMembers(message.members);
        }
        if (message.is_owner !== undefined) {
          setIsOwner(message.is_owner);
        }
        break;
      case 'group-operation-result':
        toaster.create({
          title: message.message,
          type: message.success ? 'success' : 'error',
          duration: 2000,
        });
        break;
      case 'backend-synth-complete':
        // The identity is what lets the completion name THIS turn. A legacy
        // backend sends only the type; then the identity stays null and the
        // completion remains untagged (the legacy handshake).
        setBackendSynthCompleteIdentity(readPlaybackIdentity(message));
        setBackendSynthComplete(true);
        break;
      case 'force-new-message':
        setForceNewMessage(true);
        break;
      case 'world-state':
        // Authoritative World/Life snapshot for the observability widget.
        setLifeSnapshot(toLifeSnapshot(message));
        break;
      case 'interrupt-signal':
        // Handle forwarded interrupt
        interrupt(false); // do not send interrupt signal to server
        break;
      case 'tool_call_status':
        if (message.tool_id && message.tool_name && message.status) {
          // If there's browser view data included, store it in the browser context
          if (message.browser_view) {
            console.debug('Browser view data received');
            setBrowserViewData(message.browser_view);
          }

          appendOrUpdateToolCallMessage({
            id: message.tool_id,
            type: 'tool_call_status',
            role: 'ai',
            tool_id: message.tool_id,
            tool_name: message.tool_name,
            name: message.name,
            status: message.status as ('running' | 'completed' | 'error'),
            content: message.content || '',
            timestamp: message.timestamp || new Date().toISOString(),
          });
        } else {
          console.warn('Received incomplete tool_call_status message');
        }
        break;
      default:
        console.warn('Unknown message type:', message.type);
    }
  }, [aiState, addAudioTask, appendHumanMessage, baseUrl, bgUrlContext, setAiState, setConfName, setConfUid, setConfigFiles, setCurrentHistoryUid, setHistoryList, applyHistoryData, noteChainStart, setModelInfo, setSubtitleText, startMic, stopMic, setSelfUid, setGroupMembers, setIsOwner, backendSynthComplete, setBackendSynthComplete, setBackendSynthCompleteIdentity, clearResponse, handleControlMessage, appendOrUpdateToolCallMessage, interrupt, setBrowserViewData, t]);

  useEffect(() => {
    wsService.connect(wsUrl);
  }, [wsUrl]);

  // Re-apply the persisted Voice Output setting to the backend whenever the
  // connection (re)opens, so a reload/reconnect keeps the same TTS state.
  // Same moment refreshes the Life State snapshot (widget visible only) so
  // reconnects always re-derive time_context with the current user timezone.
  useEffect(() => {
    if (wsState !== 'OPEN') return;
    const enabled = loadVoiceOutputEnabled();
    wsService.sendMessage({ type: 'voice-output-toggle', enabled });
    if (lifeStateEnabledRef.current) {
      wsService.sendMessage({ type: 'fetch-world-state', timezone: getUserTimezone() });
    }
  }, [wsState]);

  useEffect(() => {
    const stateSubscription = wsService.onStateChange(setWsState);
    const messageSubscription = wsService.onMessage(handleWebSocketMessage);
    return () => {
      stateSubscription.unsubscribe();
      messageSubscription.unsubscribe();
    };
  }, [wsUrl, handleWebSocketMessage]);

  const webSocketContextValue = useMemo(() => ({
    sendMessage: wsService.sendMessage.bind(wsService),
    wsState,
    reconnect: () => wsService.connect(wsUrl),
    wsUrl,
    setWsUrl,
    baseUrl,
    setBaseUrl,
  }), [wsState, wsUrl, baseUrl]);

  return (
    <WebSocketContext.Provider value={webSocketContextValue}>
      {children}
    </WebSocketContext.Provider>
  );
}

export default WebSocketHandler;
