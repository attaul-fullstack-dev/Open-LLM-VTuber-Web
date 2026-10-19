/* eslint-disable import/no-extraneous-dependencies */
import { Button, Stack, Text } from '@chakra-ui/react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { settingStyles } from './setting-styles';
import { useAgentSettings } from '@/hooks/sidebar/setting/use-agent-settings';
import { SwitchField, NumberField, SettingSection } from './common';
import { useWebSocket } from '@/context/websocket-context';
import { useChatHistory } from '@/context/chat-history-context';
import { wsService, MessageEvent } from '@/services/websocket-service';
import {
  CharacterMemoryDialog,
  CharacterMemoryItem,
  CharacterMemoryLauncher,
  EpisodicSearchView,
  MemoryEpisodicItem,
  MemoryOverview,
} from './character-memory-dialog';
import {
  AttachmentMemoryDialog,
  AttachmentMemoryLauncher,
} from './attachment-memory-dialog';
import {
  normalizeAttachmentRecords,
  resolveAttachmentDeleteOutcome,
} from '@/utils/attachment-memory-status';
import { planMemoryFetch } from '@/utils/memory-fetch-plan';
import type {
  AttachmentDeleteResult,
  AttachmentMemoryRecord,
} from '@/utils/attachment-memory-status';

interface AgentProps {
  onSave?: (callback: () => void) => () => void
  onCancel?: (callback: () => void) => () => void
}

// One page of episodic search results; "load more" appends the next page.
const EPISODIC_PAGE_SIZE = 50;

function Agent({ onSave, onCancel }: AgentProps): JSX.Element {
  const { t } = useTranslation();
  const { sendMessage, wsState } = useWebSocket();
  const { currentHistoryUid } = useChatHistory();
  const [memories, setMemories] = useState<CharacterMemoryItem[]>([]);
  const [memoryDialogOpen, setMemoryDialogOpen] = useState(false);
  const [memoryOverview, setMemoryOverview] = useState<MemoryOverview | null>(null);
  const [episodicSearch, setEpisodicSearch] = useState<EpisodicSearchView | null>(null);
  const [attachmentMemories, setAttachmentMemories] = useState<AttachmentMemoryRecord[]>([]);
  const [attachmentDialogOpen, setAttachmentDialogOpen] = useState(false);
  const [lastAttachmentDelete, setLastAttachmentDelete] = useState<AttachmentDeleteResult | null>(null);
  // The query and opaque keyset cursor of the in-flight episodic search.
  // Kept in refs so the message subscription (registered once) can both
  // ignore stale responses and re-run the active search after a mutation.
  const episodicQueryRef = useRef('');
  const episodicCursorRef = useRef<string | null>(null);
  const episodicActiveRef = useRef(false);
  const wsStateRef = useRef(wsState);
  wsStateRef.current = wsState;
  const {
    settings,
    handleAllowProactiveSpeakChange,
    handleIdleSecondsChange,
    handleAllowButtonTriggerChange,
  } = useAgentSettings({ onSave, onCancel });

  useEffect(() => {
    const subscription = wsService.onMessage((message: MessageEvent) => {
      if (message.type === 'character-memory') {
        setMemories(message.memories || []);
      } else if (message.type === 'memory-overview') {
        // The unified Memory Manager snapshot: facts feed the launcher
        // count, everything feeds the dialog sections.
        const overview = (message.overview || null) as MemoryOverview | null;
        setMemoryOverview(overview);
        setMemories((overview && overview.facts) || []);
      } else if (message.type === 'episodic-search-results') {
        // Ignore a response for a query the user has already replaced.
        const query = String(message.query ?? '');
        if (query !== episodicQueryRef.current) return;
        const incoming = (message.events || []) as MemoryEpisodicItem[];
        const base = {
          query,
          total: Number(message.total || 0),
          hasMore: Boolean(message.has_more),
          loading: false,
          status: (message.status || 'ok') as EpisodicSearchView['status'],
        };
        setEpisodicSearch((prev) => {
          if (!message.append || !prev || prev.query !== query) {
            return { ...base, events: incoming };
          }
          // Keyset pagination cannot repeat a row; dedupe defensively so a
          // re-delivered page can never duplicate an entry.
          const seen = new Set(prev.events.map((event) => event.id));
          const events = [...prev.events];
          for (const event of incoming) {
            if (!seen.has(event.id)) {
              seen.add(event.id);
              events.push(event);
            }
          }
          return { ...base, events };
        });
        episodicCursorRef.current = message.next_cursor ?? null;
      } else if (
        message.type === 'character-memory-deleted'
        || message.type === 'character-memory-reset'
        || message.type === 'character-state-reset'
        || message.type === 'episodic-event-deleted'
        || message.type === 'interaction-preference-deleted'
        || message.type === 'future-intention-cancelled'
      ) {
        // Refresh the unified list after any memory mutation.
        sendMessage({ type: 'fetch-memory-overview' });
        // Keep an active episodic search honest: repeat it so a deleted or
        // newly added event is reflected instead of showing a stale page.
        if (episodicActiveRef.current && wsStateRef.current === 'OPEN') {
          sendMessage({
            type: 'search-episodic-events',
            query: episodicQueryRef.current,
            limit: EPISODIC_PAGE_SIZE,
          });
        }
      } else if (message.type === 'attachment-memories') {
        setAttachmentMemories(normalizeAttachmentRecords(message.memories));
      } else if (message.type === 'attachment-memory-deleted') {
        // Keep the authoritative purge outcome for the dialog banner,
        // then refresh the list.
        setLastAttachmentDelete(resolveAttachmentDeleteOutcome(message));
        sendMessage({ type: 'fetch-attachment-memories' });
      } else if (message.type === 'attachment-memories-cleared') {
        setLastAttachmentDelete(null);
        sendMessage({ type: 'fetch-attachment-memories' });
      }
    });
    return () => subscription.unsubscribe();
    // Memory fetching is driven by the history-scoped effect below, so this
    // subscription only registers listeners (no dependency on wsState).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sendMessage]);

  // The backend resolves a character's conf_uid only after a history is
  // resumed, so fetching at socket-OPEN alone (before resume) returns an
  // empty list and nothing used to refetch it. Re-fetch whenever the active
  // history becomes known or changes; never repeat the same uid.
  const lastFetchedHistoryUidRef = useRef<string | null>(null);
  useEffect(() => {
    if (wsState !== 'OPEN') {
      // Reconnect resets the guard so the resumed history refetches.
      lastFetchedHistoryUidRef.current = null;
      episodicQueryRef.current = '';
      episodicCursorRef.current = null;
      episodicActiveRef.current = false;
      setEpisodicSearch(null);
      return;
    }
    if (planMemoryFetch(wsState, currentHistoryUid, lastFetchedHistoryUidRef.current) !== 'fetch') {
      return;
    }
    lastFetchedHistoryUidRef.current = currentHistoryUid ?? null;
    // A different character/history owns a different episodic store.
    episodicQueryRef.current = '';
    episodicCursorRef.current = null;
    episodicActiveRef.current = false;
    setEpisodicSearch(null);
    sendMessage({ type: 'fetch-memory-overview' });
    sendMessage({ type: 'fetch-attachment-memories' });
  }, [wsState, currentHistoryUid, sendMessage]);

  const requestEpisodicSearch = (query: string): void => {
    if (wsState !== 'OPEN') return;
    episodicQueryRef.current = query;
    episodicCursorRef.current = null;
    episodicActiveRef.current = true;
    setEpisodicSearch({
      query,
      events: [],
      total: 0,
      hasMore: false,
      loading: true,
      status: 'empty',
    });
    sendMessage({
      type: 'search-episodic-events',
      query,
      limit: EPISODIC_PAGE_SIZE,
    });
  };

  const loadMoreEpisodic = (): void => {
    if (wsState !== 'OPEN') return;
    // The default (bounded overview) view has no cursor yet: the first
    // "load more" starts a keyset search; later ones append.
    if (!episodicSearch) {
      requestEpisodicSearch('');
      return;
    }
    const cursor = episodicCursorRef.current;
    if (!cursor) return;
    episodicQueryRef.current = episodicSearch.query;
    setEpisodicSearch((prev) => (prev ? { ...prev, loading: true } : prev));
    sendMessage({
      type: 'search-episodic-events',
      query: episodicSearch.query,
      limit: EPISODIC_PAGE_SIZE,
      cursor,
    });
  };

  return (
    <Stack {...settingStyles.common.container}>
      <SettingSection title={t('settings.sections.proactive')}>
        <SwitchField
          label={t('settings.agent.allowProactiveSpeak')}
          checked={settings.allowProactiveSpeak}
          onChange={handleAllowProactiveSpeakChange}
        />

        {settings.allowProactiveSpeak && (
          <NumberField
            label={t('settings.agent.idleSecondsToSpeak')}
            value={settings.idleSecondsToSpeak}
            onChange={(value) => handleIdleSecondsChange(Number(value))}
            min={0}
            step={0.1}
            allowMouseWheel
          />
        )}

        <SwitchField
          label={t('settings.agent.allowButtonTrigger')}
          checked={settings.allowButtonTrigger}
          onChange={handleAllowButtonTriggerChange}
        />
      </SettingSection>

      <SettingSection title={t('settings.sections.memory')}>
        <Text fontSize="sm" color="fg.muted">
          {t('settings.agent.characterMemoryHelp')}
        </Text>
        <CharacterMemoryLauncher
          count={memories.length}
          onClick={() => setMemoryDialogOpen(true)}
        />
        <CharacterMemoryDialog
          memories={memories}
          overview={memoryOverview}
          episodicSearch={episodicSearch}
          open={memoryDialogOpen}
          disabled={wsState !== 'OPEN'}
          onOpenChange={(open) => {
            setMemoryDialogOpen(open);
            // Opening the dialog is an explicit user action: the list shown
            // would otherwise be frozen at history-resume time (or the last
            // mutation), so facts stored since -- which Mili already recalls
            // -- never appeared until the history changed. Refetch on every
            // open; the backend serves the authoritative file, so this can
            // only make the list fresher, never staler.
            if (open && wsState === 'OPEN') {
              sendMessage({ type: 'fetch-memory-overview' });
            } else if (!open) {
              // Drop the search view on close so reopening starts from the
              // bounded overview again.
              episodicQueryRef.current = '';
              episodicCursorRef.current = null;
              episodicActiveRef.current = false;
              setEpisodicSearch(null);
            }
          }}
          onEpisodicSearch={requestEpisodicSearch}
          onEpisodicLoadMore={loadMoreEpisodic}
          onDelete={(memory) => sendMessage({
            type: 'delete-character-memory',
            text: memory.text,
          })}
          onDeleteAll={() => sendMessage({ type: 'reset-character-memory' })}
          onDeleteEpisodic={(eventId) => sendMessage({
            type: 'delete-episodic-event',
            event_id: eventId,
          })}
          onDeletePreference={(preferenceId) => sendMessage({
            type: 'delete-interaction-preference',
            preference_id: preferenceId,
          })}
          onCancelIntention={(intentionId) => sendMessage({
            type: 'cancel-future-intention',
            intention_id: intentionId,
          })}
        />
        <AttachmentMemoryLauncher
          count={attachmentMemories.length}
          onClick={() => setAttachmentDialogOpen(true)}
        />
        <AttachmentMemoryDialog
          records={attachmentMemories}
          lastResult={lastAttachmentDelete}
          open={attachmentDialogOpen}
          disabled={wsState !== 'OPEN'}
          onOpenChange={(open) => {
            setAttachmentDialogOpen(open);
            // Opening the dialog is an explicit user action: refetch only if
            // the active history has not been fetched yet (history switch,
            // reconnect, or the panel was opened before any resume).
            if (open && currentHistoryUid) {
              if (lastFetchedHistoryUidRef.current !== currentHistoryUid) {
                lastFetchedHistoryUidRef.current = currentHistoryUid;
                sendMessage({ type: 'fetch-attachment-memories' });
              }
            }
          }}
          onDelete={(record) => sendMessage({
            type: 'delete-attachment-memory',
            record_id: record.id,
          })}
          onDeleteAll={() => sendMessage({ type: 'clear-attachment-memories' })}
        />
      </SettingSection>

      <SettingSection title={t('settings.sections.danger')}>
        <Stack gap={2}>
          <Text fontSize="sm" color="fg.muted">
            {t('settings.agent.resetRelationshipHelp')}
          </Text>
          <Button
            colorPalette="red"
            variant="outline"
            disabled={!currentHistoryUid || wsState !== 'OPEN'}
            onClick={() => {
              if (window.confirm(t('settings.agent.resetRelationshipConfirm'))) {
                sendMessage({ type: 'reset-relationship' });
              }
            }}
          >
            {t('settings.agent.resetRelationship')}
          </Button>
        </Stack>

        <Stack gap={2}>
          <Text fontSize="sm" color="fg.muted">
            {t('settings.agent.resetCharacterStateHelp')}
          </Text>
          <Button
            colorPalette="red"
            variant="outline"
            disabled={wsState !== 'OPEN'}
            onClick={() => {
              if (window.confirm(t('settings.agent.resetCharacterStateConfirm'))) {
                sendMessage({ type: 'reset-character-state' });
              }
            }}
          >
            {t('settings.agent.resetCharacterState')}
          </Button>
        </Stack>
      </SettingSection>
    </Stack>
  );
}

export default Agent;
