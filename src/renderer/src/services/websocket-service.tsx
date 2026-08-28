/* eslint-disable global-require */
/* eslint-disable @typescript-eslint/no-var-requires */
/* eslint-disable no-use-before-define */
import { Subject } from 'rxjs';
import { ModelInfo } from '@/context/live2d-config-context';
import { HistoryInfo } from '@/context/websocket-context';
import { ConfigFile } from '@/context/character-config-context';
import { toaster } from '@/components/ui/toaster';
import { markWebSocketSend } from '@/utils/chat-latency';

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

  // Fields for different message types (make optional)
  type?: 'text' | 'tool_call_status'; // Add possible types, default to 'text' if omitted
  tool_id?: string; // Specific to tool calls
  tool_name?: string; // Specific to tool calls
  status?: 'running' | 'completed' | 'error'; // Specific to tool calls
}

export interface Actions {
  expressions?: string[] | number [];
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

  static getInstance() {
    if (!WebSocketService.instance) {
      WebSocketService.instance = new WebSocketService();
    }
    return WebSocketService.instance;
  }

  private initializeConnection() {
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

  private scheduleReconnect() {
    if (
      this.explicitlyDisconnected
      || !this.currentUrl
      || this.reconnectTimer
      || this.ws?.readyState === WebSocket.OPEN
      || this.ws?.readyState === WebSocket.CONNECTING
    ) return;

    // One bounded retry timer prevents reconnect storms while still recovering
    // automatically after a backend restart or brief mobile-network drop.
    const delayMs = Math.min(1000 * (2 ** this.reconnectAttempt), 10000);
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.currentUrl && !this.explicitlyDisconnected) {
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
      this.ws.close();
    }

    try {
      const socket = new WebSocket(url);
      this.ws = socket;
      this.currentState = 'CONNECTING';
      this.stateSubject.next('CONNECTING');

      socket.onopen = () => {
        if (this.ws !== socket) return;
        this.reconnectAttempt = 0;
        this.currentState = 'OPEN';
        this.stateSubject.next('OPEN');
        this.initializeConnection();
      };

      socket.onmessage = (event) => {
        if (this.ws !== socket) return;
        try {
          const message = JSON.parse(event.data);
          this.messageSubject.next(message);
        } catch (error) {
          console.error('Failed to parse WebSocket message:', error);
          toaster.create({
            title: `${getTranslation()('error.failedParseWebSocket')}: ${error}`,
            type: "error",
            duration: 2000,
          });
        }
      };

      socket.onclose = () => {
        // Ignore a late close event from a socket superseded by connect().
        if (this.ws !== socket) return;
        this.ws = null;
        this.currentState = 'CLOSED';
        this.stateSubject.next('CLOSED');
        this.scheduleReconnect();
      };

      socket.onerror = () => {
        if (this.ws !== socket) return;
        // Browsers normally follow this with `close`; closing explicitly makes
        // that lifecycle deterministic without starting a second retry timer.
        socket.close();
      };
    } catch (error) {
      console.error('Failed to connect to WebSocket:', error);
      this.currentState = 'CLOSED';
      this.stateSubject.next('CLOSED');
      this.ws = null;
      this.scheduleReconnect();
    }
  }

  sendMessage(message: object): boolean {
    if (this.ws?.readyState === WebSocket.OPEN) {
      const outgoing = { ...message } as Record<string, unknown>;
      if (outgoing.type === 'text-input' && typeof outgoing.request_id === 'string') {
        outgoing.client_websocket_send_ms = markWebSocketSend(outgoing.request_id);
      }
      try {
        this.ws.send(JSON.stringify(outgoing));
        return true;
      } catch (error) {
        console.warn('WebSocket send failed; reconnecting.', error);
        this.ws.close();
      }
    } else {
      const messageType = 'type' in message ? String(message.type) : 'unknown';
      console.warn('WebSocket is not open. Unable to send message type:', messageType);
      toaster.create({
        title: getTranslation()('error.websocketNotOpen'),
        type: 'error',
        duration: 2000,
      });
    }
    this.scheduleReconnect();
    return false;
  }

  onMessage(callback: (message: MessageEvent) => void) {
    return this.messageSubject.subscribe(callback);
  }

  onStateChange(callback: (state: 'CONNECTING' | 'OPEN' | 'CLOSING' | 'CLOSED') => void) {
    return this.stateSubject.subscribe(callback);
  }

  disconnect() {
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
}

export const wsService = WebSocketService.getInstance();
