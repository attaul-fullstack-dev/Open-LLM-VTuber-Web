/* eslint-disable import/no-extraneous-dependencies */
import {
  Box, Button, Flex, Icon, IconButton, Stack, Text,
} from '@chakra-ui/react';
import { FiChevronRight, FiPaperclip, FiTrash2 } from 'react-icons/fi';
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
import { attachmentDisplayName } from '@/utils/attachment-memory-status';
import type {
  AttachmentDeleteResult,
  AttachmentMemoryRecord,
  AttachmentRemainingSource,
} from '@/utils/attachment-memory-status';

interface AttachmentMemoryDialogProps {
  records: AttachmentMemoryRecord[]
  lastResult: AttachmentDeleteResult | null
  open: boolean
  disabled?: boolean
  onOpenChange: (open: boolean) => void
  onDelete: (record: AttachmentMemoryRecord) => void
  onDeleteAll: () => void
}

function remainingLabel(
  t: (key: string, options?: Record<string, unknown>) => string,
  item: AttachmentRemainingSource,
): string {
  switch (item.kind) {
    case 'episodic':
      return t('notification.attachmentRemainingEpisodic', { count: item.count });
    case 'transcripts':
      return t('notification.attachmentRemainingTranscripts', { count: item.count });
    case 'summaries':
      return t('notification.attachmentRemainingSummaries', { count: item.count });
    case 'character':
      return t('notification.attachmentRemainingCharacter', { count: item.count });
    case 'world':
      return t('notification.attachmentRemainingWorld', { count: item.count });
    default:
      return '';
  }
}

function OutcomeBanner({ lastResult }: { lastResult: AttachmentDeleteResult }): JSX.Element | null {
  const { t } = useTranslation();
  const { outcome, remaining } = lastResult;
  if (outcome === 'legacy-success') {
    return (
      <Box p={3} borderRadius="xl" borderWidth="1px" borderColor={miliTokens.color.border} bg={miliTokens.color.surface}>
        <Text fontSize="sm" color={miliTokens.color.textSecondary}>
          {t('settings.agent.purgeLegacy')}
        </Text>
      </Box>
    );
  }
  if (outcome === 'complete') {
    return (
      <Box p={3} borderRadius="xl" borderWidth="1px" borderColor="green.700" bg={miliTokens.color.surface}>
        <Text fontSize="sm" color="green.300" fontWeight="semibold">
          {t('settings.agent.purgeComplete')}
        </Text>
      </Box>
    );
  }
  if (outcome === 'partial') {
    return (
      <Box p={3} borderRadius="xl" borderWidth="1px" borderColor="yellow.700" bg={miliTokens.color.surface}>
        <Text fontSize="sm" color="yellow.300" fontWeight="semibold">
          {t('settings.agent.purgePartial')}
        </Text>
        {remaining.length > 0 && (
          <Stack gap={0.5} pt={1.5}>
            {remaining.map((item) => (
              <Text key={item.kind} fontSize="xs" color={miliTokens.color.textSecondary}>
                {`• ${remainingLabel(t, item)}`}
              </Text>
            ))}
          </Stack>
        )}
      </Box>
    );
  }
  return (
    <Box p={3} borderRadius="xl" borderWidth="1px" borderColor="red.700" bg={miliTokens.color.surface}>
      <Text fontSize="sm" color="red.300" fontWeight="semibold">
        {outcome === 'unknown'
          ? t('settings.agent.purgeUnknown')
          : t('settings.agent.purgeFailed')}
      </Text>
    </Box>
  );
}

export function AttachmentMemoryLauncher({
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
          <Icon as={FiPaperclip} boxSize="18px" />
        </Flex>
        <Box minWidth={0}>
          <Text color={miliTokens.color.textPrimary} fontSize="sm" fontWeight="semibold">
            {t('settings.agent.openAttachments')}
          </Text>
          <Text color={miliTokens.color.textMuted} fontSize="xs">
            {t('settings.agent.attachmentCount', { count })}
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

export function AttachmentMemoryDialog({
  records,
  lastResult,
  open,
  disabled = false,
  onOpenChange,
  onDelete,
  onDeleteAll,
}: AttachmentMemoryDialogProps): JSX.Element {
  const { t } = useTranslation();

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
              {t('settings.agent.attachmentMemory')}
            </DialogTitle>
            <Text color={miliTokens.color.textSecondary} fontSize="sm" lineHeight="1.45">
              {t('settings.agent.attachmentMemoryDescription')}
            </Text>
            <Text color={miliTokens.color.textPrimary} fontSize="sm" fontWeight="semibold" pt={1}>
              {t('settings.agent.attachmentCount', { count: records.length })}
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
          <Stack gap={3}>
            {lastResult !== null && <OutcomeBanner lastResult={lastResult} />}
            {records.length === 0 ? (
              <Flex
                minHeight="180px"
                align="center"
                justify="center"
                textAlign="center"
                color={miliTokens.color.textMuted}
              >
                <Text fontSize="sm">{t('settings.agent.noAttachmentMemory')}</Text>
              </Flex>
            ) : (
              <Stack gap={3}>
                {records.map((record) => (
                  <Flex
                    key={record.id}
                    align="flex-start"
                    gap={3}
                    p={{ base: 3, sm: 4 }}
                    borderRadius="xl"
                    borderWidth="1px"
                    borderColor={miliTokens.color.border}
                    bg={miliTokens.color.surface}
                  >
                    <Box flex="1" minWidth={0}>
                      <Text
                        color={miliTokens.color.textPrimary}
                        fontSize="sm"
                        fontWeight="semibold"
                        overflowWrap="anywhere"
                      >
                        {attachmentDisplayName(record, t('settings.agent.untitledAttachment'))}
                      </Text>
                      <Text
                        color={miliTokens.color.textSecondary}
                        fontSize="sm"
                        lineHeight="1.5"
                        whiteSpace="pre-wrap"
                        overflowWrap="anywhere"
                        pt={1}
                      >
                        {record.summary || t('settings.agent.attachmentNeverRead')}
                      </Text>
                      <Text color={miliTokens.color.textMuted} fontSize="xs" pt={1}>
                        {[
                          record.source,
                          (record.received_at || '').slice(0, 10),
                          record.status === 'failed'
                            ? t('settings.agent.attachmentStatusFailed')
                            : '',
                        ].filter((part) => part !== '').join(' • ')}
                      </Text>
                    </Box>
                    <IconButton
                      aria-label={t('settings.agent.forgetAttachment')}
                      title={t('settings.agent.forgetAttachment')}
                      variant="ghost"
                      colorPalette="red"
                      color="red.300"
                      width="44px"
                      height="44px"
                      minWidth="44px"
                      flexShrink={0}
                      onClick={() => {
                        if (window.confirm(t('settings.agent.deleteAttachmentConfirm'))) {
                          onDelete(record);
                        }
                      }}
                    >
                      <FiTrash2 />
                    </IconButton>
                  </Flex>
                ))}
              </Stack>
            )}
          </Stack>
        </DialogBody>

        <DialogFooter
          px={{ base: 4, sm: 6 }}
          pt={3}
          pb={{ base: 'max(14px, env(safe-area-inset-bottom))', sm: 5 }}
          borderTopWidth="1px"
          borderColor={miliTokens.color.border}
          bg={miliTokens.color.drawer}
        >
          <Button
            width="100%"
            minHeight="44px"
            colorPalette="red"
            variant="outline"
            disabled={disabled || records.length === 0}
            onClick={() => {
              if (window.confirm(t('settings.agent.clearAttachmentsConfirm'))) {
                onDeleteAll();
              }
            }}
          >
            {t('settings.agent.clearAttachments')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </DialogRoot>
  );
}
