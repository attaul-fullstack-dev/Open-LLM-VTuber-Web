import {
  Box, IconButton, Menu, Portal,
} from '@chakra-ui/react';
import {
  FiTrash2, FiEdit2, FiArchive, FiMoreVertical,
} from 'react-icons/fi';
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
  index: number;
  isSelected: boolean;
  title?: string | null;
  onSelect: () => void;
  onRename: () => void;
  onCompact: () => void;
  onDelete: () => void;
  isDeleteDisabled: boolean;
}

// Reusable components
const HistoryItem = memo(({
  index,
  isSelected,
  title,
  onSelect,
  onRename,
  onCompact,
  onDelete,
  isDeleteDisabled,
}: HistoryItemProps): JSX.Element => {
  const { t } = useTranslation();
  const cleanDisplayText = (value: string) => value
    .replace(/\[[a-z][a-z0-9_-]*\]\s*/gi, '')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/([.!?])(?=[A-Z])/g, '$1 ')
    .replace(/\s+/g, ' ')
    .trim();
  const storedTitle = cleanDisplayText(title || '');
  const displayTitle = storedTitle || t('history.newChat');
  // UI-only session number from render position. Never stored in history.
  const sessionNumber = String(index + 1).padStart(2, '0');
  return (
    <Box
      {...sidebarStyles.historyDrawer.historyItem}
      {...(isSelected ? sidebarStyles.historyDrawer.historyItemSelected : {})}
    >
      <Box {...sidebarStyles.historyDrawer.historyBody}>
        <Box {...sidebarStyles.historyDrawer.sessionNumber}>
          {sessionNumber}
        </Box>
        <Box
          minW="0"
          flex="1"
          cursor="pointer"
          onClick={onSelect}
        >
          <Box
            {...sidebarStyles.historyDrawer.title}
            {...(isSelected ? sidebarStyles.historyDrawer.titleSelected : {})}
            title={displayTitle}
          >
            {displayTitle}
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
                <Menu.Item
                  value="rename"
                  {...sidebarStyles.historyDrawer.menuItem}
                  onClick={onRename}
                >
                  <FiEdit2 />
                  {t('history.rename')}
                </Menu.Item>
                <Menu.Item
                  value="compact"
                  {...sidebarStyles.historyDrawer.menuItem}
                  onClick={onCompact}
                >
                  <FiArchive />
                  {t('history.compact')}
                </Menu.Item>
                <Menu.Item
                  value="delete"
                  disabled={isDeleteDisabled}
                  {...sidebarStyles.historyDrawer.menuItemDanger}
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
            {historyList.map((history: HistoryInfo, index: number) => (
              <HistoryItem
                key={history.uid}
                index={index}
                isSelected={currentHistoryUid === history.uid}
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
