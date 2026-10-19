/* eslint-disable import/no-extraneous-dependencies */
import {
  Box, Button, Flex, Icon, IconButton, Input, Spinner, Stack, Text,
} from '@chakra-ui/react';
import { useEffect, useRef, useState } from 'react';
import { FiAlertTriangle, FiBookOpen, FiChevronRight, FiTrash2 } from 'react-icons/fi';
import { useTranslation } from 'react-i18next';
import { miliTokens } from '@/theme/design-tokens';
import {
  DialogBody,
  DialogCloseTrigger,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogRoot,
  DialogTitle,
} from '@/components/ui/dialog';

export interface CharacterMemoryItem {
  text: string
  added_at: string
  explicit?: boolean
}

/**
 * Render only metadata the backend actually stores. `explicit` tells
 * whether the fact came from a user command (manual) or from automatic
 * extraction; `added_at` is the persisted timestamp. Nothing is invented:
 * fields that are absent or unparseable simply hide their part.
 */
function memorySourceLabel(explicit: boolean | undefined, t: (key: string) => string): string {
  return t(explicit
    ? 'settings.agent.memorySourceManual'
    : 'settings.agent.memorySourceAuto');
}

function memoryDateLabel(addedAt: string | undefined): string {
  if (typeof addedAt !== 'string') return '';
  const match = addedAt.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : '';
}

/**
 * Shown when a category could not be read. Plainly says load failed, so the
 * user never mistakes a read error for "you have no data here".
 */
function MemoryCategoryError({ label }: { label: string }): JSX.Element {
  return (
    <Flex
      align="center"
      gap={2}
      p={{ base: 3, sm: 4 }}
      borderRadius="xl"
      borderWidth="1px"
      borderColor="red.500"
      bg="red.900"
    >
      <Icon as={FiAlertTriangle} color="red.300" boxSize="16px" flexShrink={0} />
      <Text color="red.200" fontSize="sm" lineHeight="1.45">
        {label}
      </Text>
    </Flex>
  );
}

export interface MemoryPreferenceItem {
  id: string
  category: string
  polarity: string
  text: string
  updated_at?: string
}

export interface MemoryIntentionItem {
  id: string
  text: string
  due_at?: string
}

export interface MemoryEpisodicItem {
  id: string
  event_text: string
  occurred_at?: string | null
}

export interface MemoryWorldSnapshot {
  location?: string
  activity?: string
  energy?: number | null
  mood?: string
  time_context?: string
  last_update_at?: string
}

/**
 * Per-category read status from the backend. `ok`/`empty` mean the store was
 * read (the latter genuinely empty); `error` means the store could not be
 * read, so the UI must say so instead of implying the category is empty.
 */
export type MemoryCategoryStatus = 'ok' | 'empty' | 'error'

export interface MemoryOverview {
  facts: CharacterMemoryItem[]
  preferences: MemoryPreferenceItem[]
  intentions: MemoryIntentionItem[]
  episodic: { total: number, events: MemoryEpisodicItem[] }
  world: MemoryWorldSnapshot | null
  status?: {
    facts: MemoryCategoryStatus
    preferences: MemoryCategoryStatus
    intentions: MemoryCategoryStatus
    episodic: MemoryCategoryStatus
    world: MemoryCategoryStatus
  }
}

/**
 * Live episodic search state. The default view comes from the bounded
 * overview (latest N); once the user searches or pages, this replaces it so
 * an old event outside the latest window is still reachable.
 */
export interface EpisodicSearchView {
  query: string
  events: MemoryEpisodicItem[]
  total: number
  hasMore: boolean
  loading: boolean
  status: MemoryCategoryStatus
}

interface CharacterMemoryDialogProps {
  memories: CharacterMemoryItem[]
  overview: MemoryOverview | null
  episodicSearch: EpisodicSearchView | null
  open: boolean
  disabled?: boolean
  onOpenChange: (open: boolean) => void
  onDelete: (memory: CharacterMemoryItem) => void
  onDeleteAll: () => void
  onDeleteEpisodic: (eventId: string) => void
  onDeletePreference: (preferenceId: string) => void
  onCancelIntention: (intentionId: string) => void
  onEpisodicSearch: (query: string) => void
  onEpisodicLoadMore: () => void
}

export function CharacterMemoryLauncher({
  count,
  onClick,
}: {
  count: number
  onClick: () => void
}): JSX.Element {
  const { t } = useTranslation();

  return (
    <Button
      variant="outline"
      colorPalette="gray"
      onClick={onClick}
      width="100%"
      height="auto"
      minHeight="52px"
      px={3}
      py={2.5}
      justifyContent="space-between"
      borderColor={miliTokens.color.border}
      bg={miliTokens.color.surface}
      _hover={{ bg: 'whiteAlpha.100', borderColor: miliTokens.color.borderStrong }}
    >
      <Flex align="center" gap={3} minWidth={0} textAlign="left">
        <Flex
          width="36px"
          height="36px"
          flexShrink={0}
          align="center"
          justify="center"
          borderRadius="full"
          bg={miliTokens.color.accentSoft}
          color={miliTokens.color.accentText}
        >
          <Icon as={FiBookOpen} boxSize="18px" />
        </Flex>
        <Box minWidth={0}>
          <Text color={miliTokens.color.textPrimary} fontSize="sm" fontWeight="semibold">
            {t('settings.agent.openMemory')}
          </Text>
          <Text color={miliTokens.color.textMuted} fontSize="xs">
            {t('settings.agent.memoryCount', { count })}
          </Text>
        </Box>
      </Flex>
      <Flex align="center" gap={1} color={miliTokens.color.textSecondary} flexShrink={0}>
        <Text fontSize="sm" fontWeight="semibold">{count}</Text>
        <Icon as={FiChevronRight} boxSize="18px" />
      </Flex>
    </Button>
  );
}

export function CharacterMemoryDialog({
  memories,
  overview,
  episodicSearch,
  open,
  disabled = false,
  onOpenChange,
  onDelete,
  onDeleteAll,
  onDeleteEpisodic,
  onDeletePreference,
  onCancelIntention,
  onEpisodicSearch,
  onEpisodicLoadMore,
}: CharacterMemoryDialogProps): JSX.Element {
  const { t } = useTranslation();
  const preferences = (overview && overview.preferences) || [];
  const intentions = (overview && overview.intentions) || [];
  const episodic = (overview && overview.episodic) || { total: 0, events: [] };
  const world = (overview && overview.world) || null;
  const status = overview?.status;
  const failed = (category: keyof NonNullable<MemoryOverview['status']>): boolean =>
    status?.[category] === 'error';
  const loadFailedLabel = t('settings.agent.memoryCategoryLoadFailed');

  // The default view is the bounded overview; a search/page view supersedes
  // it once the user looks for something older than the latest window.
  const episodicView: EpisodicSearchView = episodicSearch || {
    query: '',
    events: episodic.events,
    total: episodic.total,
    hasMore: episodic.total > episodic.events.length,
    loading: false,
    status: status?.episodic || 'empty',
  };
  const [searchText, setSearchText] = useState('');
  const searchCallbackRef = useRef(onEpisodicSearch);
  const lastRequestedRef = useRef('');
  useEffect(() => {
    searchCallbackRef.current = onEpisodicSearch;
  });
  // Debounced live search. `lastRequestedRef` prevents the effect from
  // re-firing for a query that was already sent (and keeps clearing cheap).
  useEffect(() => {
    const query = searchText.trim();
    if (query === lastRequestedRef.current) return undefined;
    const timer = setTimeout(() => {
      lastRequestedRef.current = query;
      searchCallbackRef.current(query);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchText]);
  useEffect(() => {
    if (!open) {
      setSearchText('');
      lastRequestedRef.current = '';
    }
  }, [open]);

  return (
    <DialogRoot open={open} onOpenChange={(details) => onOpenChange(details.open)}>
      <DialogContent
        bg={miliTokens.color.drawer}
        color={miliTokens.color.textPrimary}
        width={{ base: '100vw', sm: 'min(92vw, 620px)' }}
        maxWidth={{ base: '100vw', sm: '620px' }}
        height={{ base: '100dvh', sm: 'min(86dvh, 720px)' }}
        maxHeight={{ base: '100dvh', sm: '720px' }}
        borderRadius={{ base: 0, sm: '2xl' }}
        borderWidth={{ base: 0, sm: '1px' }}
        borderColor={miliTokens.color.border}
        overflow="hidden"
        display="flex"
        flexDirection="column"
      >
        <DialogHeader
          px={{ base: 4, sm: 6 }}
          pt={{ base: 'max(18px, env(safe-area-inset-top))', sm: 6 }}
          pb={4}
          pr={{ base: 14, sm: 16 }}
          borderBottomWidth="1px"
          borderColor={miliTokens.color.border}
          flexShrink={0}
        >
          <Stack gap={1}>
            <DialogTitle fontSize={{ base: 'lg', sm: 'xl' }} fontWeight="bold">
              {t('settings.agent.characterMemory')}
            </DialogTitle>
            <Text color={miliTokens.color.textSecondary} fontSize="sm" lineHeight="1.45">
              {t('settings.agent.memoryDescription')}
            </Text>
            <Text color={miliTokens.color.textPrimary} fontSize="sm" fontWeight="semibold" pt={1}>
              {t('settings.agent.memoryCount', { count: memories.length })}
            </Text>
          </Stack>
          <DialogCloseTrigger
            aria-label={t('common.close')}
            top={{ base: 'max(14px, env(safe-area-inset-top))', sm: 4 }}
            right={{ base: 3, sm: 4 }}
            width="44px"
            height="44px"
            color={miliTokens.color.textSecondary}
          />
        </DialogHeader>

        <DialogBody
          minHeight={0}
          flex="1"
          overflowY="auto"
          overscrollBehavior="contain"
          px={{ base: 4, sm: 6 }}
          py={4}
          css={{
            scrollbarWidth: 'thin',
            scrollbarColor: 'rgba(255,255,255,.24) transparent',
          }}
        >
          {failed('facts') ? (
            <MemoryCategoryError label={loadFailedLabel} />
          ) : memories.length === 0 ? (
            <Flex
              minHeight="180px"
              align="center"
              justify="center"
              textAlign="center"
              color={miliTokens.color.textMuted}
            >
              <Text fontSize="sm">{t('settings.agent.noCharacterMemory')}</Text>
            </Flex>
          ) : (
            <Stack gap={3}>
              {memories.map((memory, index) => (
                <Flex
                  key={`${memory.text}-${index}`}
                  align="flex-start"
                  gap={3}
                  p={{ base: 3, sm: 4 }}
                  borderRadius="xl"
                  borderWidth="1px"
                  borderColor={miliTokens.color.border}
                  bg={miliTokens.color.surface}
                >
                  <Stack flex="1" minWidth={0} gap={1}>
                    <Text
                      color={miliTokens.color.textPrimary}
                      fontSize="sm"
                      lineHeight="1.5"
                      whiteSpace="pre-wrap"
                      overflowWrap="anywhere"
                    >
                      {memory.text}
                    </Text>
                    <Text
                      color={miliTokens.color.textMuted}
                      fontSize="xs"
                    >
                      {[
                        memorySourceLabel(memory.explicit, t),
                        memoryDateLabel(memory.added_at),
                      ].filter(Boolean).join(' · ')}
                    </Text>
                  </Stack>
                  <IconButton
                    aria-label={t('settings.agent.forgetMemory')}
                    title={t('settings.agent.forgetMemory')}
                    variant="ghost"
                    colorPalette="red"
                    color="red.300"
                    width="44px"
                    height="44px"
                    minWidth="44px"
                    flexShrink={0}
                    onClick={() => {
                      if (window.confirm(t('settings.agent.deleteMemoryConfirm'))) {
                        onDelete(memory);
                      }
                    }}
                  >
                    <FiTrash2 />
                  </IconButton>
                </Flex>
              ))}
            </Stack>
          )}

          {failed('preferences') ? (
            <MemoryCategoryError label={loadFailedLabel} />
          ) : preferences.length > 0 && (
            <Stack gap={2} mt={6}>
              <Text color={miliTokens.color.textPrimary} fontSize="sm" fontWeight="semibold">
                {t('settings.agent.memorySectionPreferences', { count: preferences.length })}
              </Text>
              {preferences.map((preference) => (
                <Flex
                  key={preference.id}
                  align="flex-start"
                  gap={3}
                  p={{ base: 3, sm: 4 }}
                  borderRadius="xl"
                  borderWidth="1px"
                  borderColor={miliTokens.color.border}
                  bg={miliTokens.color.surface}
                >
                  <Stack flex="1" minWidth={0} gap={1}>
                    <Text
                      color={miliTokens.color.textPrimary}
                      fontSize="sm"
                      lineHeight="1.5"
                      whiteSpace="pre-wrap"
                      overflowWrap="anywhere"
                    >
                      {preference.text}
                    </Text>
                    <Text color={miliTokens.color.textMuted} fontSize="xs">
                      {[
                        preference.category,
                        preference.polarity,
                        memoryDateLabel(preference.updated_at),
                      ].filter(Boolean).join(' · ')}
                    </Text>
                  </Stack>
                  <IconButton
                    aria-label={t('settings.agent.forgetPreference')}
                    title={t('settings.agent.forgetPreference')}
                    variant="ghost"
                    colorPalette="red"
                    color="red.300"
                    width="44px"
                    height="44px"
                    minWidth="44px"
                    flexShrink={0}
                    onClick={() => {
                      if (window.confirm(t('settings.agent.deletePreferenceConfirm'))) {
                        onDeletePreference(preference.id);
                      }
                    }}
                  >
                    <FiTrash2 />
                  </IconButton>
                </Flex>
              ))}
            </Stack>
          )}

          {failed('intentions') ? (
            <MemoryCategoryError label={loadFailedLabel} />
          ) : intentions.length > 0 && (
            <Stack gap={2} mt={6}>
              <Text color={miliTokens.color.textPrimary} fontSize="sm" fontWeight="semibold">
                {t('settings.agent.memorySectionIntentions', { count: intentions.length })}
              </Text>
              {intentions.map((intention) => (
                <Flex
                  key={intention.id}
                  align="flex-start"
                  gap={3}
                  p={{ base: 3, sm: 4 }}
                  borderRadius="xl"
                  borderWidth="1px"
                  borderColor={miliTokens.color.border}
                  bg={miliTokens.color.surface}
                >
                  <Stack flex="1" minWidth={0} gap={1}>
                    <Text
                      color={miliTokens.color.textPrimary}
                      fontSize="sm"
                      lineHeight="1.5"
                      whiteSpace="pre-wrap"
                      overflowWrap="anywhere"
                    >
                      {intention.text}
                    </Text>
                    {memoryDateLabel(intention.due_at) && (
                      <Text color={miliTokens.color.textMuted} fontSize="xs">
                        {memoryDateLabel(intention.due_at)}
                      </Text>
                    )}
                  </Stack>
                  <IconButton
                    aria-label={t('settings.agent.cancelIntention')}
                    title={t('settings.agent.cancelIntention')}
                    variant="ghost"
                    colorPalette="red"
                    color="red.300"
                    width="44px"
                    height="44px"
                    minWidth="44px"
                    flexShrink={0}
                    onClick={() => {
                      if (window.confirm(t('settings.agent.cancelIntentionConfirm'))) {
                        onCancelIntention(intention.id);
                      }
                    }}
                  >
                    <FiTrash2 />
                  </IconButton>
                </Flex>
              ))}
            </Stack>
          )}

          <Stack gap={2} mt={6}>
            <Text color={miliTokens.color.textPrimary} fontSize="sm" fontWeight="semibold">
              {t('settings.agent.memorySectionEpisodicTitle')}
            </Text>
            <Input
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              placeholder={t('settings.agent.memorySearchEpisodicPlaceholder')}
              disabled={disabled}
              size="sm"
              bg={miliTokens.color.surface}
              borderColor={miliTokens.color.border}
              color={miliTokens.color.textPrimary}
            />
            {episodicView.loading ? (
              <Flex
                align="center"
                gap={2}
                p={3}
                color={miliTokens.color.textSecondary}
              >
                <Spinner size="sm" />
                <Text fontSize="sm">{t('settings.agent.memorySearchLoading')}</Text>
              </Flex>
            ) : episodicView.status === 'error' ? (
              <MemoryCategoryError label={loadFailedLabel} />
            ) : episodicView.events.length === 0 ? (
              <Text color={miliTokens.color.textMuted} fontSize="sm">
                {episodicView.query
                  ? t('settings.agent.memorySearchNoResults')
                  : t('settings.agent.noEpisodicMemory')}
              </Text>
            ) : (
              <>
                <Text color={miliTokens.color.textMuted} fontSize="xs">
                  {t('settings.agent.memorySectionEpisodic', {
                    shown: episodicView.events.length,
                    total: episodicView.total,
                  })}
                </Text>
                {episodicView.events.map((event) => (
                  <Flex
                    key={event.id}
                    align="flex-start"
                    gap={3}
                    p={{ base: 3, sm: 4 }}
                    borderRadius="xl"
                    borderWidth="1px"
                    borderColor={miliTokens.color.border}
                    bg={miliTokens.color.surface}
                  >
                    <Stack flex="1" minWidth={0} gap={1}>
                      <Text
                        color={miliTokens.color.textPrimary}
                        fontSize="sm"
                        lineHeight="1.5"
                        whiteSpace="pre-wrap"
                        overflowWrap="anywhere"
                      >
                        {event.event_text}
                      </Text>
                      {memoryDateLabel(event.occurred_at || undefined) && (
                        <Text color={miliTokens.color.textMuted} fontSize="xs">
                          {memoryDateLabel(event.occurred_at || undefined)}
                        </Text>
                      )}
                    </Stack>
                    <IconButton
                      aria-label={t('settings.agent.forgetEvent')}
                      title={t('settings.agent.forgetEvent')}
                      variant="ghost"
                      colorPalette="red"
                      color="red.300"
                      width="44px"
                      height="44px"
                      minWidth="44px"
                      flexShrink={0}
                      onClick={() => {
                        if (window.confirm(t('settings.agent.deleteEventConfirm'))) {
                          onDeleteEpisodic(event.id);
                        }
                      }}
                    >
                      <FiTrash2 />
                    </IconButton>
                  </Flex>
                ))}
                {episodicView.hasMore && (
                  <Button
                    size="sm"
                    variant="outline"
                    alignSelf="flex-start"
                    disabled={disabled}
                    onClick={onEpisodicLoadMore}
                  >
                    {t('settings.agent.memoryLoadMore')}
                  </Button>
                )}
              </>
            )}
          </Stack>

          {failed('world') ? (
            <MemoryCategoryError label={loadFailedLabel} />
          ) : world && (
            <Stack gap={2} mt={6}>
              <Text color={miliTokens.color.textPrimary} fontSize="sm" fontWeight="semibold">
                {t('settings.agent.memorySectionWorld')}
              </Text>
              <Flex
                align="flex-start"
                gap={3}
                p={{ base: 3, sm: 4 }}
                borderRadius="xl"
                borderWidth="1px"
                borderColor={miliTokens.color.border}
                bg={miliTokens.color.surface}
              >
                <Stack flex="1" minWidth={0} gap={1}>
                  <Text
                    color={miliTokens.color.textPrimary}
                    fontSize="sm"
                    lineHeight="1.5"
                    whiteSpace="pre-wrap"
                    overflowWrap="anywhere"
                  >
                    {[
                      world.activity,
                      world.location,
                      world.mood,
                    ].filter(Boolean).join(' · ')}
                  </Text>
                  <Text color={miliTokens.color.textMuted} fontSize="xs">
                    {t('settings.agent.memoryWorldReadOnly')}
                  </Text>
                </Stack>
              </Flex>
            </Stack>
          )}
        </DialogBody>

        <DialogFooter
          px={{ base: 4, sm: 6 }}
          pt={3}
          pb={{ base: 'max(14px, env(safe-area-inset-bottom))', sm: 5 }}
          borderTopWidth="1px"
          borderColor={miliTokens.color.border}
          bg={miliTokens.color.drawer}
          flexShrink={0}
        >
          <Button
            width="100%"
            minHeight="44px"
            colorPalette="red"
            variant="outline"
            disabled={disabled || memories.length === 0}
            onClick={() => {
              if (window.confirm(t('settings.agent.resetMemoryConfirm'))) {
                onDeleteAll();
              }
            }}
          >
            {t('settings.agent.deleteAllMemory')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </DialogRoot>
  );
}
