// Deterministic regression harness for the AI transcript append path.
//
// Renders the REAL ChatHistoryProvider (no mocks) and exposes its public API on
// `window.__race` so a browser driver can exercise it. Audio-segment appends in
// production come from TaskQueue executions that may fall inside a single React
// tick; calling them back-to-back synchronously is the purest form of that race:
// with a passive-effect read mirror both calls observe the same array and the
// second full-array replacement discards the first segment.
//
// TEST ENTRY ONLY — never part of the application build (that uses
// src/renderer/index.html). A test driver bundles this with esbuild into a
// temporary directory.
import React from 'react';
import { createRoot } from 'react-dom/client';
import {
  ChatHistoryProvider,
  useChatHistory,
} from '../src/renderer/src/context/chat-history-context';

type Ctx = ReturnType<typeof useChatHistory>;

function Probe() {
  const chat: Ctx = useChatHistory();
  (window as unknown as { __race: RaceApi }).__race.messages = chat.messages;
  (window as unknown as { __ctx: Ctx }).__ctx = chat;
  (window as unknown as { __race: RaceApi }).__race.ready = true;
  return null;
}

interface RaceApi {
  ready: boolean;
  messages: Ctx['messages'];
  appendAI: (text: string, requestId?: string) => void;
  appendHuman: (text: string, requestId?: string) => void;
  applyHistoryData: (messages: unknown[], historyUid?: string | null) => void;
  noteChainStart: (historyUid?: string | null) => void;
  applyCanonicalFinal: (requestId: string, text: string, historyUid?: string | null) => void;
  appendFlushedSegments: (segments: unknown[]) => { healed: number; dropped: number };
  setForceNewMessage: (value: boolean) => void;
  setCurrentHistoryUid: (uid: string | null) => void;
}

const api: RaceApi = {
  ready: false,
  messages: [],
  appendAI: (text, requestId) => {
    (window as unknown as { __ctx: Ctx }).__ctx.appendAIMessage(
      text, undefined, undefined, requestId,
    );
  },
  appendHuman: (text, requestId) => {
    (window as unknown as { __ctx: Ctx }).__ctx.appendHumanMessage(text, requestId);
  },
  applyHistoryData: (messages, historyUid) => {
    (window as unknown as { __ctx: Ctx }).__ctx.applyHistoryData(
      messages as Ctx['messages'], historyUid,
    );
  },
  noteChainStart: (historyUid) => {
    (window as unknown as { __ctx: Ctx }).__ctx.noteChainStart(historyUid);
  },
  applyCanonicalFinal: (requestId, text, historyUid) => {
    (window as unknown as { __ctx: Ctx }).__ctx.applyCanonicalFinalToBubble(
      requestId, text, historyUid,
    );
  },
  appendFlushedSegments: (segments) => (window as unknown as { __ctx: Ctx })
    .__ctx.appendFlushedSegments(segments as never),
  setForceNewMessage: (value) => {
    (window as unknown as { __ctx: Ctx }).__ctx.setForceNewMessage(value);
  },
  setCurrentHistoryUid: (uid) => {
    (window as unknown as { __ctx: Ctx }).__ctx.setCurrentHistoryUid(uid);
  },
};
(window as unknown as { __race: RaceApi }).__race = api;

createRoot(document.getElementById('root') as HTMLElement).render(
  <ChatHistoryProvider>
    <Probe />
  </ChatHistoryProvider>,
);
