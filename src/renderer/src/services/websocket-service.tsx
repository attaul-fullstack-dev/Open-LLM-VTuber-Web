/* eslint-disable global-require */
/* eslint-disable @typescript-eslint/no-var-requires */
/* eslint-disable no-use-before-define */
import { Subject } from 'rxjs';
import { ModelInfo } from '@/context/live2d-config-context';
import { HistoryInfo } from '@/context/websocket-context';
import { ConfigFile } from '@/context/character-config-context';
import { toaster } from '@/components/ui/toaster';
import { markWebSocketSend } from '@/utils/chat-latency';
import {
  forgetIncidentEpisode,
  getActiveConnectionId,
  logWsDiag,
  markConnError,
  markConnSendFailure,
  nextConnectionId,
  recordCloseIncident,
  setActiveConnectionId,
} from '@/utils/ws-diagnostics';
import {
  describeInboundFrame,
  installLifecycleLogging,
} from '@/utils/ws-lifecycle-log';
import type { AttachmentPurgeStatus } from '@/utils/attachment-memory-status';

export interface DisplayText {
  text: string;
  name: string;
  avatar: string;
}

interface BackgroundFile {
  name: string;
  url: string;
}

export interface AudioPayload {
  type: 'audio';
  audio?: string;
  volumes?: number[];
  slice_length?: number;
  display_text?: DisplayText;
  actions?: Actions;
}

export interface Message {
  id: string;
  content: string;
  role: "ai" | "human";
  timestamp: string;
  name?: string;
  avatar?: string;
  /** Backend turn request_id for AI bubbles built from audio payloads. */
  requestId?: string;

  // Fields for different message types (make optional)
  type?: 'text' | 'tool_call_status'; // Add possible types, default to 'text' if omitted
  tool_id?: string; // Specific to tool calls
  tool_name?: string; // Specific to tool calls
  status?: 'running' | 'completed' | 'error'; // Specific to tool calls
}

export interface Actions {
  expressions?: string[] | number [];
  emotions?: (string | null)[] | null;
  pictures?: string[];
  sounds?: string[];
}

export interface MessageEvent {
  tool_id: any;
  tool_name: any;
  name: any;
  status: any;
  content: string;
  timestamp: string;
  type: string;
  audio?: string;
  volumes?: number[];
  slice_length?: number;
  files?: BackgroundFile[];
  actions?: Actions;
  text?: string;
  model_info?: ModelInfo;
  conf_name?: string;
  conf_uid?: string;
  uids?: string[];
  messages?: Message[];
  history_uid?: string;
  success?: boolean;
  histories?: HistoryInfo[];
  configs?: ConfigFile[];
  title?: string;
  // World/Life State snapshot fields (backend `world-state` message).
  location?: string;
  activity?: string;
  energy?: number;
  mood?: string;
  time_context?: string;
  activity_started_at?: string;
  last_update_at?: string;
  memories?: {
    text: string;
    added_at: string;
    explicit?: boolean;
  }[];
  error?: string;
  message?: string;
  event?: string;
  request_id?: string;
  metrics?: Record<string, unknown>;
  // Attachment Memory deletion result (backend `attachment-memory-deleted`).
  purge?: AttachmentPurgeStatus;
  record_id?: string;
  removed?: number;
  members?: string[];
  is_owner?: boolean;
  client_uid?: string;
  forwarded?: boolean;
  display_text?: DisplayText;
  live2d_model?: string;
  browser_view?: {
    debuggerFullscreenUrl: string;
    debuggerUrl: string;
    pages: {
      id: string;
      url: string;
      faviconUrl: string;
      title: string;
      debuggerUrl: string;
      debuggerFullscreenUrl: string;
    }[];
    wsUrl: string;
    sessionId?: string;
  };
}

// Get translation function for error messages
const getTranslation = () => {
  try {
    const i18next = require('i18next').default;
    return i18next.t.bind(i18next);
  } catch (e) {
    // Fallback if i18next is not available
    return (key: string) => key;
  }
};

class WebSocketService {
  private static instance: WebSocketService;

  private ws: WebSocket | null = null;

  private messageSubject = new Subject<MessageEvent>();

  private stateSubject = new Subject<'CONNECTING' | 'OPEN' | 'CLOSING' | 'CLOSED'>();

  private currentState: 'CONNECTING' | 'OPEN' | 'CLOSING' | 'CLOSED' = 'CLOSED';

  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  private reconnectAttempt = 0;

  private currentUrl: string | null = null;

  private explicitlyDisconnected = false;

  // Diagnostic-only connection identity (BUG B capture). Assigned per
  // socket creation; never affects lifecycle decisions.
  private connId = 'ws0';

  // Diagnostic-only: uninstaller for the browser-lifecycle listeners. Those
  // listeners are installed once for the lifetime of the window and are never
  // torn down mid-session, because a disconnect/reconnect cycle must keep
  // observing the page lifecycle. Retained so teardown stays possible and
  // testable.
  private readonly uninstallLifecycleLogging: () => void;

  // Diagnostic-only reconnect tracking. Set when a retry timer is armed,
  // consumed on the next open/failed-connect — never drives behavior.
  private reconnectPending = false;
  private openedConns = new Set<string>();

  constructor() {
    // Diagnostic-only and observation-only: start recording browser lifecycle
    // transitions (visibilitychange / pagehide / pageshow / freeze / resume)
    // next to the socket events. Installation is idempotent per window, so a
    // repeated construction cannot double-register listeners, and nothing here
    // can alter lifecycle, timing, reconnect or any WebSocket behaviour.
    this.uninstallLifecycleLogging = installLifecycleLogging({
      doc: typeof document === 'undefined' ? null : document,
      win: typeof window === 'undefined' ? null : window,
      probe: {
        visibilityState: () =>
          typeof document === 'undefined' ? null : document.visibilityState,
        hidden: () => (typeof document === 'undefined' ? null : document.hidden),
        readyState: () => this.ws?.readyState ?? null,
      },
      log: (detail, formatted) => {
        logWsDiag(
          'LIFECYCLE',
          getActiveConnectionId(),
          formatted,
          detail.readyState,
        );
      },
    });
  }

  /**
   * Diagnostic-only: stop recording browser lifecycle transitions.
   * Not called by the app (listeners live for the window's lifetime, so a
   * reconnect keeps observing the page); exposed so teardown stays reachable
   * when debugging in DevTools.
   */
  disposeDiagnosticLogging(): void {
    try {
      this.uninstallLifecycleLogging();
    } catch {
      // Diagnostics must never break the app.
    }
  }

  static getInstance() {
    if (!WebSocketService.instance) {
      WebSocketService.instance = new WebSocketService();
    }
    return WebSocketService.instance;
  }

  private initializeConnection() {
    logWsDiag('HISTORY_LIST_REQUEST', this.connId);
    this.sendMessage({
      type: 'fetch-backgrounds',
    });
    this.sendMessage({
      type: 'fetch-configs',
    });
    this.sendMessage({
      type: 'fetch-history-list',
    });
  }

  private clearReconnectTimer() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private scheduleReconnect(reason: string) {
    if (
      this.explicitlyDisconnected
      || !this.currentUrl
      || this.reconnectTimer
      || this.ws?.readyState === WebSocket.OPEN
      || this.ws?.readyState === WebSocket.CONNECTING
    ) {
      // Diagnostic-only: record suppressed attempts too.
      logWsDiag('RECONNECT_SUPPRESSED', this.connId, `reason=${reason}`);
      return;
    }

    // One bounded retry timer prevents reconnect storms while still recovering
    // automatically after a backend restart or brief mobile-network drop.
    const delayMs = Math.min(1000 * (2 ** this.reconnectAttempt), 10000);
    this.reconnectAttempt += 1;
    this.reconnectPending = true;
    logWsDiag('RECONNECT_SCHEDULED', this.connId, `reason=${reason} delayMs=${delayMs}`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.currentUrl && !this.explicitlyDisconnected) {
        logWsDiag('RECONNECT_START', this.connId, `reason=${reason}`);
        this.connect(this.currentUrl);
      }
    }, delayMs);
  }

  connect(url: string) {
    this.currentUrl = url;
    this.explicitlyDisconnected = false;
    this.clearReconnectTimer();

    if (this.ws?.readyState === WebSocket.CONNECTING ||
        this.ws?.readyState === WebSocket.OPEN) {
      // Diagnostic-only: superseding a live socket is itself an event.
      logWsDiag('WS_SUPERSEDE_CLOSE', this.connId, `readyState=${this.ws.readyState}`);
      this.ws.close();
    }

    try {
      const socket = new WebSocket(url);
      this.ws = socket;
      this.connId = nextConnectionId();
      const connId = this.connId;
      setActiveConnectionId(connId);
      logWsDiag('WS_CREATE', connId);
      this.currentState = 'CONNECTING';
      this.stateSubject.next('CONNECTING');

      socket.onopen = () => {
        if (this.ws !== socket) return;
        this.reconnectAttempt = 0;
        this.currentState = 'OPEN';
        this.stateSubject.next('OPEN');
        this.openedConns.add(connId);
        if (this.reconnectPending) {
          this.reconnectPending = false;
          logWsDiag('RECONNECT_SUCCESS', connId);
        }
        logWsDiag('WS_OPEN', connId);
        // A freshly opened connection closes the previous incident episode,
        // so a genuinely new incident can raise the popup again later.
        forgetIncidentEpisode(connId);
        this.initializeConnection();
      };

      socket.onmessage = (event) => {
        if (this.ws !== socket) return;
        // Diagnostic-only: proves whether the browser was still RECEIVING
        // frames before an abnormal close. Records the message TYPE and a byte
        // count only — never the payload, never any field of it.
        const inbound = describeInboundFrame(event.data);
        logWsDiag('WS_RECV', connId, inbound.detail, socket.readyState);
        try {
          const message = JSON.parse(event.data);
          this.messageSubject.next(message);
        } catch (error) {
          // Diagnostic-only: a frame we could not classify (binary audio, or
          // malformed JSON) still proves the socket delivered bytes.
          logWsDiag('WS_RECV_UNPARSED', connId, inbound.detail, socket.readyState);
          console.error('Failed to parse WebSocket message:', error);
          toaster.create({
            title: `${getTranslation()('error.failedParseWebSocket')}: ${error}`,
            type: "error",
            duration: 2000,
          });
        }
      };

      socket.onclose = (event) => {
        // Ignore a late close event from a socket superseded by connect().
        if (this.ws !== socket) return;
        this.ws = null;
        this.currentState = 'CLOSED';
        this.stateSubject.next('CLOSED');
        const code = typeof event?.code === 'number' ? event.code : null;
        const reason = typeof event?.reason === 'string' ? event.reason : '';
        logWsDiag(
          'WS_CLOSE', connId,
          `code=${code} reason=${reason} readyState=${socket.readyState}`,
          socket.readyState,
        );
        if (!this.openedConns.has(connId)) {
          // Diagnostic-only: a connect attempt died before opening.
          logWsDiag('RECONNECT_FAILED', connId, `code=${code} reason=${reason}`);
        }
        // Diagnostic-only incident snapshot. Runs BEFORE scheduleReconnect
        // so the old connection's facts survive resync.
        recordCloseIncident({
          connId,
          code,
          reason,
          readyStateAtClose: socket.readyState,
          reconnectScheduled: !this.explicitlyDisconnected && !!this.currentUrl,
        });
        this.scheduleReconnect('onclose');
      };

      socket.onerror = () => {
        if (this.ws !== socket) return;
        markConnError(connId);
        logWsDiag('WS_ERROR', connId, `readyState=${socket.readyState}`, socket.readyState);
        // Browsers normally follow this with `close`; closing explicitly makes
        // that lifecycle deterministic without starting a second retry timer.
        socket.close();
      };
    } catch (error) {
      console.error('Failed to connect to WebSocket:', error);
      this.currentState = 'CLOSED';
      this.stateSubject.next('CLOSED');
      this.ws = null;
      logWsDiag('WS_CREATE_FAILED', this.connId, `error=${error}`);
      this.scheduleReconnect('connect-throw');
    }
  }

  sendMessage(message: object): boolean {
    const messageType = 'type' in message ? String(message.type) : 'unknown';
    const before = this.ws?.readyState;
    if (this.ws && before === WebSocket.OPEN) {
      const outgoing = { ...message } as Record<string, unknown>;
      if (outgoing.type === 'text-input' && typeof outgoing.request_id === 'string') {
        outgoing.client_websocket_send_ms = markWebSocketSend(outgoing.request_id);
      }
      try {
        this.ws.send(JSON.stringify(outgoing));
        logWsDiag('WS_SEND', this.connId, `type=${messageType} readyState=${before}`, before);
        return true;
      } catch (error) {
        console.warn('WebSocket send failed; reconnecting.', error);
        markConnSendFailure(this.connId);
        logWsDiag('WS_SEND_FAILED', this.connId, `type=${messageType} readyState=${before} error=${error}`, before);
        this.ws.close();
      }
    } else {
      console.warn('WebSocket is not open. Unable to send message type:', messageType);
      markConnSendFailure(this.connId);
      logWsDiag('WS_SEND_FAILED', this.connId, `type=${messageType} readyState=${before} reason=not-open`, before);
      toaster.create({
        title: getTranslation()('error.websocketNotOpen'),
        type: 'error',
        duration: 2000,
      });
    }
    this.scheduleReconnect('send-failure');
    return false;
  }

  onMessage(callback: (message: MessageEvent) => void) {
    return this.messageSubject.subscribe(callback);
  }

  onStateChange(callback: (state: 'CONNECTING' | 'OPEN' | 'CLOSING' | 'CLOSED') => void) {
    return this.stateSubject.subscribe(callback);
  }

  disconnect() {
    logWsDiag('WS_EXPLICIT_DISCONNECT', this.connId);
    this.explicitlyDisconnected = true;
    this.clearReconnectTimer();
    this.ws?.close();
    this.ws = null;
    this.currentState = 'CLOSED';
    this.stateSubject.next('CLOSED');
  }

  getCurrentState() {
    return this.currentState;
  }

  /** Diagnostic-only current connection identity for correlating events. */
  getConnectionId() {
    return this.connId;
  }
}

export const wsService = WebSocketService.getInstance();
