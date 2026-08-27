import {
  Box, IconButton, Menu, Portal,
} from '@chakra-ui/react';
import {
  FiTrash2, FiEdit2, FiArchive, FiMoreVertical,
} from 'react-icons/fi';
import { formatDistanceToNowStrict } from 'date-fns';
import { enUS, id, zhCN } from 'date-fns/locale';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DrawerRoot,
  DrawerTrigger,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerBody,
  DrawerBackdrop,
  DrawerCloseTrigger,
} from '@/components/ui/drawer';
import { sidebarStyles } from './sidebar-styles';
import { useHistoryDrawer } from '@/hooks/sidebar/use-history-drawer';
import { HistoryInfo } from '@/context/websocket-context';

// Type definitions
interface HistoryDrawerProps {
  children: React.ReactNode;
}

interface HistoryItemProps {
  isSelected: boolean;
  latestMessage: { content: string; timestamp: string | null };
  title?: string | null;
  onSelect: () => void;
  onRename: () => void;
  onCompact: () => void;
  onDelete: () => void;
  isDeleteDisabled: boolean;
}

// Reusable components
const HistoryItem = memo(({
  isSelected,
  latestMessage,
  title,
  onSelect,
  onRename,
  onCompact,
  onDelete,
  isDeleteDisabled,
}: HistoryItemProps): JSX.Element => {
  const { t, i18n } = useTranslation();
  const cleanDisplayText = (value: string) => value
    .replace(/\[[a-z][a-z0-9_-]*\]\s*/gi, '')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/([.!?])(?=[A-Z])/g, '$1 ')
    .replace(/\s+/g, ' ')
    .trim();
  const preview = cleanDisplayText(latestMessage.content || '');
  const displayTitle = (title && title.trim()) || preview || t('history.newChat');
  const dateLocale = i18n.language.startsWith('zh')
    ? zhCN
    : (i18n.language.startsWith('id') ? id : enUS);
  return (
    <Box
      {...sidebarStyles.historyDrawer.historyItem}
      {...(isSelected ? sidebarStyles.historyDrawer.historyItemSelected : {})}
    >
      <Box {...sidebarStyles.historyDrawer.historyBody}>
        <Box
          minW="0"
          flex="1"
          cursor="pointer"
          onClick={onSelect}
        >
          <Box {...sidebarStyles.historyDrawer.title}>
            {cleanDisplayText(displayTitle)}
          </Box>
          <Box {...sidebarStyles.historyDrawer.messagePreview}>
            {preview || t('history.noMessages')}
          </Box>
          <Box {...sidebarStyles.historyDrawer.timestamp}>
          {latestMessage.timestamp
            ? formatDistanceToNowStrict(new Date(latestMessage.timestamp), {
              addSuffix: true,
              locale: dateLocale,
            })
            : t('history.noMessages')}
          </Box>
        </Box>
        <Menu.Root positioning={{ placement: 'bottom-end' }}>
          <Menu.Trigger asChild>
            <IconButton
              aria-label="Conversation actions"
              title="Conversation actions"
              {...sidebarStyles.historyDrawer.moreButton}
            >
              <FiMoreVertical />
            </IconButton>
          </Menu.Trigger>
          <Portal>
            <Menu.Positioner>
              <Menu.Content {...sidebarStyles.historyDrawer.menuContent}>
                <Menu.Item value="rename" onClick={onRename}>
                  <FiEdit2 />
                  {t('history.rename')}
                </Menu.Item>
                <Menu.Item value="compact" onClick={onCompact}>
                  <FiArchive />
                  {t('history.compact')}
                </Menu.Item>
                <Menu.Item
                  value="delete"
                  disabled={isDeleteDisabled}
                  color="red.300"
                  onClick={onDelete}
                >
                  <FiTrash2 />
                  {t('history.delete')}
                </Menu.Item>
              </Menu.Content>
            </Menu.Positioner>
          </Portal>
        </Menu.Root>
      </Box>
    </Box>
  );
});

HistoryItem.displayName = 'HistoryItem';

// Main component
function HistoryDrawer({ children }: HistoryDrawerProps): JSX.Element {
  const { t } = useTranslation();
  const {
    open,
    setOpen,
    historyList,
    currentHistoryUid,
    fetchAndSetHistory,
    deleteHistory,
    renameHistory,
    compactConversation,
    getLatestMessageContent,
  } = useHistoryDrawer();

  return (
    <DrawerRoot
      open={open}
      onOpenChange={(e) => setOpen(e.open)}
      placement="start"
    >
      <DrawerBackdrop />
      <DrawerTrigger asChild>{children}</DrawerTrigger>
      <DrawerContent {...sidebarStyles.historyDrawer.drawer.content}>
        <DrawerHeader {...sidebarStyles.historyDrawer.drawer.header}>
          <DrawerTitle {...sidebarStyles.historyDrawer.drawer.title}>
            {t('history.chatHistoryList')}
          </DrawerTitle>
          <DrawerCloseTrigger {...sidebarStyles.historyDrawer.drawer.closeButton} />
        </DrawerHeader>

        <DrawerBody>
          <Box {...sidebarStyles.historyDrawer.listContainer}>
            {historyList.map((history: HistoryInfo) => (
              <HistoryItem
                key={history.uid}
                isSelected={currentHistoryUid === history.uid}
                latestMessage={getLatestMessageContent(history)}
                title={history.title}
                onSelect={() => {
                  fetchAndSetHistory(history.uid);
                  setOpen(false);
                }}
                onRename={() => {
                  renameHistory(history.uid, history.title || '');
                }}
                onCompact={() => {
                  compactConversation(history.uid);
                }}
                onDelete={() => {
                  deleteHistory(history.uid);
                }}
                isDeleteDisabled={currentHistoryUid === history.uid}
              />
            ))}
          </Box>
        </DrawerBody>

      </DrawerContent>
    </DrawerRoot>
  );
}

export default HistoryDrawer;
