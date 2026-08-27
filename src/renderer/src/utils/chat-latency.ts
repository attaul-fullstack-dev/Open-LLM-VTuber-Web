type FrontendLatency = {
  requestId: string;
  userSendPerfMs: number;
  websocketSendPerfMs?: number;
  firstBackendStatusPerfMs?: number;
  firstTokenPerfMs?: number;
  responseCompletePerfMs?: number;
};

const requests = new Map<string, FrontendLatency>();
const recent: Array<{ ttft: number; total: number }> = [];
const MAX_RECENT = 20;

// crypto.randomUUID is only available in secure contexts (https or
// localhost). The desktop backend is usually reached over plain http via a
// LAN address (e.g. http://192.168.1.5:12393), where it is undefined and
// would throw on every send. Fall back to a Math.random-based UUID so
// request IDs keep working outside secure contexts.
function generateRequestId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // fall through to the fallback below
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = (Math.random() * 16) | 0;
    const value = char === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

export function startChatLatency() {
  const requestId = generateRequestId();
  requests.set(requestId, {
    requestId,
    userSendPerfMs: performance.now(),
  });
  return {
    requestId,
    clientUserSendMs: Date.now(),
  };
}

export function markWebSocketSend(requestId?: string) {
  if (!requestId) return undefined;
  const request = requests.get(requestId);
  if (request) request.websocketSendPerfMs = performance.now();
  return Date.now();
}

export function markBackendLatencyEvent(
  requestId: string | undefined,
  event: string | undefined,
  backendMetrics?: Record<string, unknown>,
) {
  if (!requestId || !event) return;
  const request = requests.get(requestId);
  if (!request) return;
  const now = performance.now();
  if (event === 'backend-received') {
    request.firstBackendStatusPerfMs ??= now;
    return;
  }
  if (event === 'first-token') {
    request.firstTokenPerfMs ??= now;
    return;
  }
  if (event !== 'response-complete') return;

  request.responseCompletePerfMs = now;
  const firstBackend = request.firstBackendStatusPerfMs ?? now;
  const firstToken = request.firstTokenPerfMs ?? now;
  const values = {
    request_id: requestId,
    user_send_to_websocket_ms: request.websocketSendPerfMs == null
      ? null : Math.round(request.websocketSendPerfMs - request.userSendPerfMs),
    frontend_to_first_backend_status_ms: Math.round(firstBackend - request.userSendPerfMs),
    backend_status_to_first_token_ms: Math.round(firstToken - firstBackend),
    backend_to_frontend_first_token_ms: Math.round(firstToken - firstBackend),
    frontend_to_first_token_ms: Math.round(firstToken - request.userSendPerfMs),
    frontend_total_response_ms: Math.round(now - request.userSendPerfMs),
    backend: backendMetrics || {},
  };
  console.info('[FRONTEND LATENCY]', values);

  recent.push({
    ttft: values.frontend_to_first_token_ms,
    total: values.frontend_total_response_ms,
  });
  if (recent.length > MAX_RECENT) recent.shift();
  console.info('[FRONTEND LATENCY STATS]', {
    requests: recent.length,
    average_ttft_ms: Math.round(recent.reduce((sum, item) => sum + item.ttft, 0) / recent.length),
    min_ttft_ms: Math.min(...recent.map((item) => item.ttft)),
    max_ttft_ms: Math.max(...recent.map((item) => item.ttft)),
    average_total_ms: Math.round(recent.reduce((sum, item) => sum + item.total, 0) / recent.length),
  });
  requests.delete(requestId);
}
