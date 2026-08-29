/**
 * Mili Hidup Stage 4 — lightweight response-face bus.
 *
 * A tiny module-scoped pub/sub (no framework dependency) that carries one
 * signal from where a response's emotion is known (`use-audio-task`) to where
 * the face is actually applied (`use-live2d-idle-facial`). Both live in the same
 * component tree, so a plain bus is the lightest safe link and avoids threading
 * props or a whole new context through several layers.
 *
 * Message shape: a Stage 3 semantic face id, or `null` to release the
 * contextual response face and let Stage 3 idle resume.
 */
export type ResponseFacePayload = { faceId: string | null };

type Listener = (payload: ResponseFacePayload) => void;

const listeners = new Set<Listener>();
let lastPayload: ResponseFacePayload = { faceId: null };

export const responseFaceBus = {
  /** Publish a contextual response face (or null to release). */
  publish(payload: ResponseFacePayload): void {
    lastPayload = { ...payload };
    listeners.forEach((listener) => {
      try {
        listener(lastPayload);
      } catch {
        // a listener must never break the producer
      }
    });
  },

  /** Subscribe to response-face updates; returns an unsubscribe function. */
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  /** Read the most recent payload (e.g. for tests / debug). */
  getLastPayload(): ResponseFacePayload {
    return { ...lastPayload };
  },

  clear(): void {
    listeners.clear();
    lastPayload = { faceId: null };
  },
};