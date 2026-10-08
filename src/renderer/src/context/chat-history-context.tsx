/* eslint-disable no-else-return */
import {
  createContext, useContext, useState, useMemo, useCallback, useEffect, useRef,
} from 'react';
import { Message } from '@/services/websocket-service';
import { HistoryInfo } from './websocket-context';
import {
  PendingEntry,
  capPending,
  reconcileHistoryData,
} from '@/utils/history-reconcile';
import {
  applyCanonicalFinal,
  resolveAiTarget,
} from '@/utils/turn-identity';

/**
 * Chat history context state interface
 * @interface ChatHistoryState
 */
interface ChatHistoryState {
  messages: Message[]; // Use the unified Message type
  historyList: HistoryInfo[];
  currentHistoryUid: string | null;
  appendHumanMessage: (content: string, requestId?: string) => void;
  appendAIMessage: (content: string, name?: string, avatar?: string, requestId?: string) => void;
  appendOrUpdateToolCallMessage: (toolMessageData: Partial<Message>) => void; // Accept partial data
  setMessages: (messages: Message[]) => void; // Use the unified Message type
  /**
   * History-resync entry point. Merges (never blindly replaces) so an
   * accepted-but-unpersisted local message survives a racing resync.
   */
  applyHistoryData: (messages: Message[], historyUid?: string | null) => void;
  /**
   * Turn-lifecycle entry point. Drops superseded pending entries for one
   * history when its next turn actually starts (previous turns there are
   * done or cancelled by construction). Never touches other histories.
   */
  noteChainStart: (historyUid?: string | null) => void;
  /**
   * Canonical-final entry point. Reconciles live bubble(s) of one backend
   * turn to the persisted canonical text (idempotent; split parts of the
   * same turn collapse into one bubble). Never creates bubbles, never
   * replays audio. Returns true when a bubble of the turn was found.
   */
  applyCanonicalFinalToBubble: (
    requestId: string,
    text: string,
    historyUid?: string | null,
  ) => boolean;
  setHistoryList: (
    value: HistoryInfo[] | ((prev: HistoryInfo[]) => HistoryInfo[])
  ) => void;
  setCurrentHistoryUid: (uid: string | null) => void;
  updateHistoryList: (uid: string, latestMessage: Message | null) => void; // Use the unified Message type
  fullResponse: string;
  setFullResponse: (text: string) => void;
  appendResponse: (text: string) => void;
  clearResponse: () => void;
  setForceNewMessage: (value: boolean) => void;
}

/**
 * Default values and constants
 */
const DEFAULT_HISTORY = {
  messages: [] as Message[],
  historyList: [] as HistoryInfo[],
  currentHistoryUid: null as string | null,
  fullResponse: '',
};

/**
 * Create the chat history context
 */
export const ChatHistoryContext = createContext<ChatHistoryState | null>(null);

/**
 * Chat History Provider Component
 * @param {Object} props - Provider props
 * @param {React.ReactNode} props.children - Child components
 */
export function ChatHistoryProvider({ children }: { children: React.ReactNode }) {
  // State management
  const [messages, setMessages] = useState<Message[]>(DEFAULT_HISTORY.messages);
  const [historyList, setHistoryList] = useState<HistoryInfo[]>(
    DEFAULT_HISTORY.historyList,
  );
  const [currentHistoryUid, setCurrentHistoryUid] = useState<string | null>(
    DEFAULT_HISTORY.currentHistoryUid,
  );
  const [fullResponse, setFullResponse] = useState(DEFAULT_HISTORY.fullResponse);
  const [forceNewMessage, setForceNewMessage] = useState<boolean>(false);

  // Accepted-but-unconfirmed local messages. An entry leaves this list only
  // when a server snapshot contains it (multiset match) or when a newer turn
  // on the same history starts (superseded). Bounded; never timers.
  const pendingRef = useRef<PendingEntry[]>([]);
  // Latest accepted send per history (backend request_id). Lets a chain-start
  // retire older turns' leftovers while keeping the current turn's message.
  const lastRequestRef = useRef<Map<string | null, string>>(new Map());
  const historyUidRef = useRef<string | null>(DEFAULT_HISTORY.currentHistoryUid);
  useEffect(() => {
    historyUidRef.current = currentHistoryUid;
  }, [currentHistoryUid]);
  // Read mirror for append decisions. State updaters must stay pure (they
  // can run more than once), so every side effect — ids, pending tracking,
  // flag resets — happens outside, exactly once per call. Same-tick double
  // appends would read a stale mirror; all call sites are separated by
  // awaits/network events, so at most a cosmetic extra bubble could result
  // (never a lost message: reconciliation is id/content based).
  const messagesRef = useRef<Message[]>(DEFAULT_HISTORY.messages);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  const idSeqRef = useRef(0);
  // Bubbles already reconciled to their canonical persisted text. A later
  // chunk of the same turn is necessarily a duplicate of part of it, so it
  // is ignored (identity-based, never text comparison). Bounded; ids are
  // unique per bubble and never reused.
  const finalizedRef = useRef<Set<string>>(new Set());

  const nextMessageId = useCallback((): string => {
    idSeqRef.current += 1;
    return `${Date.now().toString()}-${idSeqRef.current.toString()}`;
  }, []);

  const trackPending = useCallback((entry: PendingEntry): void => {
    // Idempotent by message id: state updaters may run more than once, and
    // a duplicate track must never create a duplicate pending entry.
    const exists = pendingRef.current.some((item) => item.id === entry.id);
    if (!exists) {
      pendingRef.current = capPending([...pendingRef.current, entry]);
    }
  }, []);

  const refreshPendingContent = useCallback((id: string, content: string): void => {
    const entry = pendingRef.current.find((item) => item.id === id);
    if (entry) {
      entry.content = content;
    } else {
      // Merging into a snapshot bubble (e.g. stream continuing right after
      // a resync): track it from here so later resyncs stay consistent.
      trackPending({
        uid: historyUidRef.current, id, role: 'ai', content,
      });
    }
  }, [trackPending]);

  /**
   * Append a human message to the chat history
   * @param content - Message content
   * @param requestId - Backend request_id of the accepted send, if any
   */
  const appendHumanMessage = useCallback((content: string, requestId?: string) => {
    const id = nextMessageId();
    const uid = historyUidRef.current;
    if (requestId) {
      lastRequestRef.current.set(uid, requestId);
    }
    const newMessage: Message = {
      id,
      content,
      role: 'human',
      type: 'text', // Explicitly set type for human messages
      timestamp: new Date().toISOString(),
    };
    trackPending({ uid, id, role: 'human', content, requestId });
    setMessages((prevMessages) => [...prevMessages, newMessage]);
  }, [nextMessageId, trackPending]);

  /**
   * Append or update an AI message in the chat history
   * @param content - Message content
   * @param requestId - Backend turn request_id when the chunk carries one.
   * A chunk that knows its turn always joins its own turn's bubble, even
   * when a newer turn already forced a new message (fixes stray bubbles
   * from trailing payloads without any timing hacks).
   */
  const appendAIMessage = useCallback((content: string, name?: string, avatar?: string, requestId?: string) => {
    const prevMessages = messagesRef.current;
    const target = resolveAiTarget(prevMessages, {
      requestId: requestId ?? null,
      forceNew: forceNewMessage,
    });
    if (target.mode === 'merge') {
      const lastMessage = prevMessages[target.index];
      // Canonically finalized bubbles already hold the persisted full
      // text; a later chunk of the same turn is a duplicate by identity.
      if (finalizedRef.current.has(lastMessage.id)) return;
      // Otherwise, merge with the owning AI text message
      const merged = {
        ...lastMessage,
        content: lastMessage.content + content,
        timestamp: new Date().toISOString(),
      };
      if (requestId && !merged.requestId) {
        merged.requestId = requestId;
      }
      refreshPendingContent(lastMessage.id, merged.content);
      const next = [...prevMessages];
      next[target.index] = merged;
      setMessages(next);
      return;
    }

    // Otherwise, create a new AI text message
    setForceNewMessage(false); // Reset the flag
    const id = nextMessageId();
    trackPending({
      uid: historyUidRef.current, id, role: 'ai', content, requestId,
    });
    setMessages([...prevMessages, {
      id,
      content,
      role: 'ai',
      type: 'text', // Explicitly set type for AI text messages
      timestamp: new Date().toISOString(),
      name,
      avatar,
      requestId,
    }]);
  }, [forceNewMessage, setForceNewMessage, nextMessageId, trackPending, refreshPendingContent]);

  /**
   * Append or update a Tool Call message using its tool_id
   * @param toolMessageData - The partial tool call message data from WebSocket
   */
  const appendOrUpdateToolCallMessage = useCallback((toolMessageData: Partial<Message>) => {
    // Ensure required fields for a tool call are present
    if (!toolMessageData.tool_id || !toolMessageData.tool_name || !toolMessageData.status || !toolMessageData.timestamp) {
      console.error('Incomplete tool message data received:', toolMessageData);
      return;
    }

    setMessages((prevMessages) => {
      const existingMessageIndex = prevMessages.findIndex(
        (msg) => msg.type === 'tool_call_status' && msg.tool_id === toolMessageData.tool_id!,
      );

      if (existingMessageIndex !== -1) {
        // Update existing tool call message status and content
        const updatedMessages = [...prevMessages];
        const existingMsg = updatedMessages[existingMessageIndex];
        updatedMessages[existingMessageIndex] = {
          ...existingMsg,
          status: toolMessageData.status, // Update status
          name: toolMessageData.name || existingMsg.name,
          content: toolMessageData.content || existingMsg.content, // Update content (result/error or keep input)
          timestamp: toolMessageData.timestamp!, // Update timestamp
        };
        return updatedMessages;
      } else {
        // Append new tool call message
        const newToolMessage: Message = {
          id: toolMessageData.tool_id!, // Use tool_id as the main ID for uniqueness
          role: 'ai',
          type: 'tool_call_status',
          name: toolMessageData.name || '',
          tool_id: toolMessageData.tool_id,
          tool_name: toolMessageData.tool_name,
          status: toolMessageData.status,
          content: toolMessageData.content || '', // Initial content (input)
          timestamp: toolMessageData.timestamp!,
          // name/avatar could potentially be added if needed
        };
        return [...prevMessages, newToolMessage];
      }
    });
  }, []);

  /**
   * Update the history list with the latest message
   * @param uid - History unique identifier
   * @param latestMessage - Latest message to update with
   */
  const updateHistoryList = useCallback(
    (uid: string, latestMessage: Message | null) => {
      if (!uid) {
        console.error('updateHistoryList: uid is null');
      }
      if (!currentHistoryUid) {
        console.error('updateHistoryList: currentHistoryUid is null');
      }

      setHistoryList((prevList) => prevList.map((history) => {
        if (history.uid === uid) {
          return {
            ...history,
            latest_message: latestMessage
              ? {
                content: latestMessage.content,
                role: latestMessage.role,
                timestamp: latestMessage.timestamp,
              }
              : null,
            timestamp: latestMessage?.timestamp || history.timestamp,
          };
        }
        return history;
      }));
    },
    [currentHistoryUid],
  );

  const appendResponse = useCallback((text: string) => {
    setFullResponse((prev) => prev + (text || ''));
  }, []);

  /**
   * Apply a server transcript WITHOUT dropping accepted local messages.
   * Only pending entries scoped to the target history participate; entries
   * for other histories are retained untouched for their own resync.
   */
  const applyHistoryData = useCallback((serverMessages: Message[], historyUid?: string | null) => {
    const target = historyUid ?? historyUidRef.current;
    const scoped = pendingRef.current.filter(
      (entry) => entry.uid === target || entry.uid == null,
    );
    const others = pendingRef.current.filter(
      (entry) => !(entry.uid === target || entry.uid == null),
    );
    const { messages: merged, remaining } = reconcileHistoryData(
      (Array.isArray(serverMessages) ? serverMessages : []).map((row) => ({
        id: String(row?.id ?? ''),
        role: row?.role,
        content: typeof row?.content === 'string' ? row.content : '',
        type: row?.type,
      })),
      scoped.map((entry) => ({
        uid: entry.uid, id: entry.id, role: entry.role, content: entry.content,
      })),
    );
    pendingRef.current = capPending([...others, ...remaining]);
    setMessages(merged as Message[]);
  }, []);

  /**
   * A turn on one history actually started: older turns there are done or
   * cancelled by construction, so their leftovers stop being pending — but
   * the just-accepted send (latest request_id) is kept until the snapshot
   * confirms it. Other histories are untouched.
   */
  const noteChainStart = useCallback((historyUid?: string | null) => {
    const target = historyUid ?? historyUidRef.current;
    const latest = lastRequestRef.current.get(target);
    pendingRef.current = pendingRef.current.filter((entry) => {
      if (!(entry.uid === target || entry.uid == null)) return true;
      if (entry.role !== 'human') return false;
      if (!entry.requestId || !latest) return true;
      return entry.requestId === latest;
    });
  }, []);

  const clearResponse = useCallback(() => {
    setFullResponse(DEFAULT_HISTORY.fullResponse);
  }, []);

  /**
   * Reconcile live bubble(s) of one backend turn to the persisted canonical
   * text. Only applies to the currently open history; split parts of the
   * same turn collapse into the first bubble (identity merge). Pure helper
   * does the work; this callback syncs pending tracking + finalized ids.
   */
  const applyCanonicalFinalToBubble = useCallback((
    requestId: string,
    text: string,
    historyUid?: string | null,
  ): boolean => {
    const target = historyUid ?? historyUidRef.current;
    // Scope to the open history when known. When the current history is
    // unknown (null), request_id — unique per backend turn — is already
    // sufficient scoping: messages state only ever holds one history, so a
    // requestId match cannot touch another history.
    const current = historyUidRef.current;
    if (target != null && current != null && target !== current) return false;
    if (!requestId || typeof text !== 'string' || text.length === 0) return false;
    const result = applyCanonicalFinal(messagesRef.current, requestId, text);
    if (!result.matched) return false;
    result.finalizedIds.forEach((id) => {
      finalizedRef.current.add(id);
      refreshPendingContent(id, text);
    });
    if (finalizedRef.current.size > 200) {
      const ids = Array.from(finalizedRef.current);
      finalizedRef.current = new Set(ids.slice(ids.length - 200));
    }
    if (result.changed) {
      setMessages(result.bubbles as Message[]);
    }
    return true;
  }, [refreshPendingContent]);

  // Memoized context value
  const contextValue = useMemo(
    () => ({
      messages,
      historyList,
      currentHistoryUid,
      appendHumanMessage,
      appendAIMessage,
      appendOrUpdateToolCallMessage, // Add to context value
      setMessages,
      applyHistoryData,
      noteChainStart,
      applyCanonicalFinalToBubble,
      setHistoryList,
      setCurrentHistoryUid,
      updateHistoryList,
      fullResponse,
      setFullResponse,
      appendResponse,
      clearResponse,
      setForceNewMessage,
    }),
    [
      messages,
      historyList,
      currentHistoryUid,
      appendHumanMessage,
      appendAIMessage,
      appendOrUpdateToolCallMessage, // Add dependency
      applyHistoryData,
      noteChainStart,
      applyCanonicalFinalToBubble,
      updateHistoryList,
      fullResponse,
      appendResponse,
      clearResponse,
      setForceNewMessage,
    ],
  );

  return (
    <ChatHistoryContext.Provider value={contextValue}>
      {children}
    </ChatHistoryContext.Provider>
  );
}

/**
 * Custom hook to use the chat history context
 * @throws {Error} If used outside of ChatHistoryProvider
 */
export function useChatHistory() {
  const context = useContext(ChatHistoryContext);

  if (!context) {
    throw new Error('useChatHistory must be used within a ChatHistoryProvider');
  }

  return context;
}
