/* eslint-disable import/no-extraneous-dependencies */
import {
  Box, Button, Flex, Icon, IconButton, Stack, Text,
} from '@chakra-ui/react';
import { FiBookOpen, FiChevronRight, FiTrash2 } from 'react-icons/fi';
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

interface CharacterMemoryDialogProps {
  memories: CharacterMemoryItem[]
  open: boolean
  disabled?: boolean
  onOpenChange: (open: boolean) => void
  onDelete: (memory: CharacterMemoryItem) => void
  onDeleteAll: () => void
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
  open,
  disabled = false,
  onOpenChange,
  onDelete,
  onDeleteAll,
}: CharacterMemoryDialogProps): JSX.Element {
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
          {memories.length === 0 ? (
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
                  <Text
                    flex="1"
                    minWidth={0}
                    color={miliTokens.color.textPrimary}
                    fontSize="sm"
                    lineHeight="1.5"
                    whiteSpace="pre-wrap"
                    overflowWrap="anywhere"
                  >
                    {memory.text}
                  </Text>
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
