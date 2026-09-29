/**
 * Pure mapping between the backend `world-state` message and the frontend
 * Life State snapshot (no React, unit-testable without a browser).
 * Single mapping point: the WebSocket case and any future consumer share
 * it, so the widget can never drift into a second state shape.
 */

/** Authoritative backend snapshot (read-only mirror, never edited locally). */
export interface LifeStateSnapshot {
  location?: string;
  activity?: string;
  energy?: number;
  mood?: string;
  time_context?: string;
  activity_started_at?: string;
  last_update_at?: string;
  error?: string;
}

/** Backend `world-state` message fields consumed by the widget. */
export interface WorldStateMessage {
  location?: string;
  activity?: string;
  energy?: number;
  mood?: string;
  time_context?: string;
  activity_started_at?: string;
  last_update_at?: string;
  error?: string;
}

export function toLifeSnapshot(message: WorldStateMessage): LifeStateSnapshot {
  return {
    location: message.location,
    activity: message.activity,
    energy: message.energy,
    mood: message.mood,
    time_context: message.time_context,
    activity_started_at: message.activity_started_at,
    last_update_at: message.last_update_at,
    error: message.error,
  };
}
