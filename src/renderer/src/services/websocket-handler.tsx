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
import { flushPendingSegmentTexts } from '@/hooks/utils/use-audio-task';
import { useBgUrl } from '@/context/bgurl-context';
import { useConfig } from '@/context/character-config-context';
import { useChatHistory } from '@/context/chat-history-context';
import { toaster } from '@/components/ui/toaster';
import { logWsDiag } from '@/utils/ws-diagnostics';
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
} from '@/utils/history-storage';
import { subtitlePlaybackCoordinator } from '@/utils/subtitle-playback';
import { loadVoiceOutputEnabled } from '@/utils/voice-output-preference';
import { useLifeState } from '@/context/life-state-context';
import { toLifeSnapshot } from '@/utils/life-state-sync';
import { getUserTimezone } from '@/utils/user-timezone';

function WebSocketHandler({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const [wsState, setWsState] = useState<string>('CLOSED');
  const [wsUrl, setWsUrl] = useLocalStorage<string>('wsUrl', defaultWsUrl);
  const [baseUrl, setBaseUrl] = useLocalStorage<string>('baseUrl', defaultBaseUrl);
  const {
    aiState, setAiState, backendSynthComplete, setBackendSynthComplete, setFirstTokenAt,
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
  }, [setAiState, setSubtitleText, clearResponse, setForceNewMessage, noteChainStart, startMic, stopMic, startSubtitleResponse, t, appendFlushedSegments, applyCanonicalFinalToBubble]);

  const handleWebSocketMessage = useCallback((message: MessageEvent) => {
    console.debug('WebSocket event received:', message.type);
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
        const canonicalText = typeof message.text === 'string' ? message.text : '';
        if (canonicalId && canonicalText) {
          logWsDiag('CANONICAL_FINAL', wsService.getConnectionId(), `chars=${canonicalText.length}`);
          applyCanonicalFinalToBubble(canonicalId, canonicalText, message.history_uid ?? null);
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
      case 'audio':
        markFrontendPayload(
          message.request_id,
          'audio',
          Boolean(message.display_text?.text),
        );
        if (aiState === 'interrupted' || aiState === 'listening') {
          console.debug('Audio playback intercepted', {
            display_characters: message.display_text?.text?.length || 0,
          });
        } else {
          console.debug('Audio payload received', {
            has_actions: Boolean(message.actions),
            display_characters: message.display_text?.text?.length || 0,
          });
          addAudioTask({
            audioBase64: message.audio || '',
            volumes: message.volumes || [],
            sliceLength: message.slice_length || 0,
            displayText: message.display_text || null,
            expressions: message.actions?.expressions || null,
            emotions: message.actions?.emotions || null,
            forwarded: message.forwarded || false,
            requestId: message.request_id ?? null,
          });
        }
        break;
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
          applyHistoryData(message.messages, message.history_uid);
        }
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
          logWsDiag(
            'ACTIVE_HISTORY_ID', wsService.getConnectionId(),
            `uid=${message.history_uid}`,
          );
          setLastHistoryUid(activeConfUidRef.current, message.history_uid);
          setCurrentHistoryUid(message.history_uid);
          // Fresh session starts empty, but an optimistic message accepted
          // just before creation (uid == null at send time) is adopted, not
          // dropped: same invariant as any other resync.
          applyHistoryData([], message.history_uid);
          const newHistory: HistoryInfo = {
            uid: message.history_uid,
            latest_message: null,
            timestamp: new Date().toISOString(),
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
      case 'history-list':
        if (message.histories) {
          logWsDiag(
            'HISTORY_LIST_RECEIVED', wsService.getConnectionId(),
            `count=${message.histories.length}`,
          );
          setHistoryList(message.histories);
          const confUidForHistory = activeConfUidRef.current;
          const rememberedUid = getLastHistoryUid(confUidForHistory);
          const decision = decideHistoryResume(
            message.histories.map((history) => history.uid),
            rememberedUid,
          );

          if (decision.type === 'resume') {
            logWsDiag(
              'RESYNC_DECISION', wsService.getConnectionId(),
              `type=resume uid=${decision.uid}`,
            );
            setLastHistoryUid(confUidForHistory, decision.uid);
            setCurrentHistoryUid(decision.uid);
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
  }, [aiState, addAudioTask, appendHumanMessage, baseUrl, bgUrlContext, setAiState, setConfName, setConfUid, setConfigFiles, setCurrentHistoryUid, setHistoryList, applyHistoryData, noteChainStart, setModelInfo, setSubtitleText, startMic, stopMic, setSelfUid, setGroupMembers, setIsOwner, backendSynthComplete, setBackendSynthComplete, clearResponse, handleControlMessage, appendOrUpdateToolCallMessage, interrupt, setBrowserViewData, t]);

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
