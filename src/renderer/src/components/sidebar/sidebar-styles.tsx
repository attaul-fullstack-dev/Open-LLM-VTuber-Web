import { css } from '@emotion/react';

const isElectron = window.api !== undefined;

const commonStyles = {
  scrollbar: {
    '&::-webkit-scrollbar': {
      width: '4px',
    },
    '&::-webkit-scrollbar-track': {
      bg: 'whiteAlpha.100',
      borderRadius: 'full',
    },
    '&::-webkit-scrollbar-thumb': {
      bg: 'whiteAlpha.300',
      borderRadius: 'full',
    },
  },
  panel: {
    border: '1px solid',
    borderColor: 'whiteAlpha.200',
    borderRadius: 'lg',
    bg: 'blackAlpha.400',
  },
  title: {
    fontSize: 'lg',
    fontWeight: 'semibold',
    color: 'white',
    mb: 4,
  },
};

export const sidebarStyles = {
  sidebar: {
    container: (isCollapsed: boolean) => ({
      position: 'absolute' as const,
      left: 0,
      top: 0,
      height: '100%',
      width: { base: '100vw', lg: '440px' },
      // Blur across a full-screen Live2D canvas is expensive on mobile while scrolling.
      // The almost-opaque background preserves the same visual separation without GPU jank.
      bg: 'rgba(17, 24, 39, .985)',
      backdropFilter: { base: 'none', lg: 'blur(12px)' },
      transform: isCollapsed
        ? 'translateX(calc(-100% + 24px))'
        : 'translateX(0)',
      transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
      display: 'flex',
      flexDirection: 'column' as const,
      gap: 4,
      overflow: isCollapsed ? 'visible' : 'hidden',
      pb: '4',
    }),
    toggleButton: {
      position: 'absolute',
      right: { base: '-42px', lg: 0 },
      top: { base: '16px', lg: 0 },
      width: { base: '38px', lg: '24px' },
      height: { base: '38px', lg: '100%' },
      display: { base: 'none', lg: 'flex' },
      alignItems: 'center',
      justifyContent: 'center',
      cursor: 'pointer',
      color: 'whiteAlpha.700',
      _hover: { color: 'white' },
      bg: { base: 'blackAlpha.600', lg: 'transparent' },
      borderRadius: { base: 'full', lg: 'none' },
      backdropFilter: { base: 'blur(10px)', lg: 'none' },
      transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
      zIndex: 1,
    },
    content: {
      flex: 1,
      width: '100%',
      display: 'flex',
      flexDirection: 'column' as const,
      gap: 4,
      overflow: 'hidden',
    },
    header: {
      width: '100%',
      display: 'flex',
      alignItems: 'center',
      gap: 2,
      px: { base: 3, lg: 2 },
      pt: { base: 3, lg: 2 },
      pb: 2,
    },
    headerButton: {
      variant: 'ghost' as const,
      minW: { base: '44px', lg: '40px' },
      width: { base: '44px', lg: '40px' },
      height: { base: '44px', lg: '40px' },
      p: 0,
      borderRadius: { base: '14px', lg: '10px' },
      color: 'whiteAlpha.800',
      bg: 'rgba(255,255,255,.035)',
      border: '1px solid rgba(255,255,255,.04)',
      _hover: { bg: 'whiteAlpha.100', color: 'white' },
      _active: { bg: 'whiteAlpha.200' },
    },
  },

  chatHistoryPanel: {
    container: {
      flex: 1,
      overflow: 'hidden',
      px: { base: 3, lg: 4 },
      display: 'flex',
      flexDirection: 'column',
    },
    title: commonStyles.title,
    messageList: {
      ...commonStyles.panel,
      p: 4,
      width: '97%',
      flex: 1,
      overflowY: 'auto',
      css: {
        ...commonStyles.scrollbar,
        scrollPaddingBottom: '1rem',
      },
      display: 'flex',
      flexDirection: 'column',
      gap: 2,
    },
  },

  systemLogPanel: {
    container: {
      width: '100%',
      overflow: 'hidden',
      px: 4,
      minH: '200px',
      marginTop: 'auto',
    },
    title: commonStyles.title,
    logList: {
      ...commonStyles.panel,
      p: 4,
      height: '200px',
      overflowY: 'auto',
      fontFamily: 'mono',
      css: commonStyles.scrollbar,
    },
    entry: {
      p: 2,
      borderRadius: 'md',
      _hover: {
        bg: 'whiteAlpha.50',
      },
    },
  },

  chatBubble: {
    container: {
      display: 'flex',
      position: 'relative',
      _hover: {
        bg: 'whiteAlpha.50',
      },
      py: 1,
      px: 2,
      borderRadius: 'md',
    },
    message: {
      maxW: '90%',
      bg: 'transparent',
      p: 2,
    },
    text: {
      fontSize: 'xs',
      color: 'whiteAlpha.900',
    },
    dot: {
      position: 'absolute',
      w: '2',
      h: '2',
      borderRadius: 'full',
      bg: 'white',
      top: '2',
    },
  },

  historyDrawer: {
    listContainer: {
      flex: 1,
      overflowY: 'auto',
      px: { base: 3, lg: 4 },
      py: { base: 1, lg: 2 },
      css: commonStyles.scrollbar,
    },
    historyItem: {
      mb: 2,
      px: 3,
      py: 2.5,
      borderRadius: 'xl',
      bg: 'rgba(255,255,255,.045)',
      border: '1px solid rgba(255,255,255,.06)',
      transition: 'all 0.2s',
      _hover: {
        bg: 'rgba(255,255,255,.075)',
      },
    },
    historyItemSelected: {
      bg: 'rgba(59,130,246,.12)',
      borderColor: 'rgba(96,165,250,.38)',
      boxShadow: 'inset 3px 0 0 #60a5fa',
    },
    historyBody: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      gap: 2,
    },
    timestamp: {
      fontSize: '11px',
      color: 'rgba(255,255,255,.58)',
      mt: 1,
    },
    deleteButton: {
      variant: 'ghost' as const,
      colorScheme: 'red' as const,
      size: 'sm' as const,
      color: 'red.300',
      opacity: 0.8,
      _hover: {
        opacity: 1,
        bg: 'whiteAlpha.200',
      },
    },
    actionButton: {
      variant: 'ghost' as const,
      colorScheme: 'whiteAlpha' as const,
      size: 'sm' as const,
      color: 'whiteAlpha.700',
      opacity: 0.8,
      _hover: {
        opacity: 1,
        bg: 'whiteAlpha.200',
      },
    },
    title: {
      fontSize: '15px',
      fontWeight: 'semibold',
      color: 'whiteAlpha.900',
      noOfLines: 1,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      mb: 0.5,
    },
    messagePreview: {
      fontSize: '13px',
      lineHeight: '1.35',
      color: 'rgba(255,255,255,.72)',
      noOfLines: 2,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
    },
    moreButton: {
      variant: 'ghost' as const,
      minW: '36px',
      width: '36px',
      height: '36px',
      borderRadius: 'full',
      bg: 'transparent',
      color: 'whiteAlpha.600',
      _hover: { color: 'white', bg: 'whiteAlpha.100' },
      _active: { color: 'white', bg: 'whiteAlpha.100' },
      _expanded: { color: 'white', bg: 'whiteAlpha.100' },
    },
    menuContent: {
      bg: 'gray.800',
      color: 'whiteAlpha.900',
      borderColor: 'whiteAlpha.200',
      minW: '190px',
      boxShadow: 'xl',
      zIndex: 1800,
    },
    menuItem: {
      color: 'rgba(255,255,255,.92)',
      bg: 'transparent',
      _highlighted: {
        color: 'white',
        bg: 'whiteAlpha.100',
      },
    },
    menuItemDanger: {
      color: 'red.300',
      bg: 'transparent',
      _highlighted: {
        color: 'red.200',
        bg: 'rgba(239,68,68,.12)',
      },
      _disabled: {
        opacity: 0.4,
      },
    },
    drawer: {
      content: {
        background: 'var(--chakra-colors-gray-900)',
        width: { base: '100vw', lg: '440px' },
        maxWidth: { base: '100vw', lg: '440px' },
        marginTop: isElectron ? '30px' : '0',
        height: isElectron ? 'calc(100vh - 30px)' : '100vh',
        borderRight: { base: 'none', lg: '1px solid rgba(255,255,255,.1)' },
      },
      header: {
        minH: { base: '64px', lg: '72px' },
        px: { base: 4, lg: 6 },
        py: 4,
        borderBottom: '1px solid rgba(255,255,255,.08)',
        alignItems: 'center',
      },
      title: {
        color: 'white',
        fontSize: { base: '20px', lg: '24px' },
        fontWeight: 'semibold',
      },
      closeButton: {
        color: 'white',
        top: { base: '14px', lg: '18px' },
        insetEnd: { base: '14px', lg: '18px' },
      },
    },
  },

  cameraPanel: {
    container: {
      width: '97%',
      overflow: 'hidden',
      px: 4,
      minH: '240px',
    },
    header: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      mb: 4,
    },
    title: commonStyles.title,
    videoContainer: {
      ...commonStyles.panel,
      width: '100%',
      height: '240px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
      transition: 'all 0.2s',
    },
    video: {
      width: '100%',
      height: '100%',
      objectFit: 'cover' as const,
      transform: 'scaleX(-1)',
      borderRadius: '8px',
      display: 'block',
    } as const,
  },

  screenPanel: {
    container: {
      width: '97%',
      overflow: 'hidden',
      px: 4,
      minH: '240px',
    },
    header: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      mb: 4,
    },
    title: commonStyles.title,
    screenContainer: {
      ...commonStyles.panel,
      width: '100%',
      height: '240px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
      transition: 'all 0.2s',
    },
    video: {
      width: '100%',
      height: '100%',
      objectFit: 'cover' as const,
      borderRadius: '8px',
      display: 'block',
    } as const,
  },

  // Add Browser Panel Styles
  browserPanel: {
    container: {
      width: '97%',
      overflow: 'hidden',
      px: 4,
      minH: '240px',
    },
    header: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      mb: 4,
    },
    title: commonStyles.title,
    browserContainer: {
      ...commonStyles.panel,
      width: '100%',
      height: '240px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
      transition: 'all 0.2s',
      cursor: 'pointer',
      _hover: {
        bg: 'whiteAlpha.100',
      },
    },
    iframe: {
      width: '100%',
      height: '100%',
      border: 'none',
      borderRadius: '8px',
    } as const,
  },

  bottomTab: {
    container: {
      width: '97%',
      px: 4,
      position: 'relative' as const,
      zIndex: 0,
    },
    tabs: {
      width: '100%',
      bg: 'whiteAlpha.50',
      borderRadius: 'lg',
      p: '1',
    },
    list: {
      borderBottom: 'none',
      gap: '2',
    },
    trigger: {
      color: 'whiteAlpha.700',
      display: 'flex',
      alignItems: 'center',
      gap: 2,
      px: 3,
      py: 2,
      borderRadius: 'md',
      _hover: {
        color: 'white',
        bg: 'whiteAlpha.50',
      },
      _selected: {
        color: 'white',
        bg: 'whiteAlpha.200',
      },
    },
  },

  groupDrawer: {
    section: {
      mb: 6,
    },
    sectionTitle: {
      fontSize: 'lg',
      fontWeight: 'semibold',
      color: 'white',
      mb: 3,
    },
    inviteBox: {
      display: 'flex',
      gap: 2,
    },
    input: {
      bg: 'whiteAlpha.100',
      border: 'none',
      color: 'white',
      _placeholder: {
        color: 'whiteAlpha.400',
      },
    },
    memberList: {
      display: 'flex',
      flexDirection: 'column',
      gap: 2,
    },
    memberItem: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      p: 2,
      borderRadius: 'md',
      bg: 'whiteAlpha.100',
    },
    memberText: {
      color: 'white',
      fontSize: 'sm',
    },
    removeButton: {
      size: 'sm',
      color: 'red.300',
      bg: 'transparent',
      _hover: {
        bg: 'whiteAlpha.200',
      },
    },
    button: {
      color: 'white',
      bg: 'whiteAlpha.100',
      _hover: {
        bg: 'whiteAlpha.200',
      },
    },
    clipboardButton: {
      color: 'white',
      bg: 'transparent',
      _hover: {
        bg: 'whiteAlpha.200',
      },
      size: 'sm',
    },
  },

  // Add styles for the Tool Call Indicator
  toolCallIndicator: {
    container: {
      pl: '44px', // Indent to align with message content (avatar width + gap)
      my: '1', // Reduced vertical margin (e.g., 4px if theme space 1 = 4px)
      gap: 2,
      width: '100%',
      minHeight: '24px', // Ensure minimum height
      display: 'flex', // Ensure display is flex
      alignItems: 'center', // Keep vertical alignment
      justifyContent: 'center', // Center items horizontally
    },
    icon: {
      color: 'blue.300',
      boxSize: '14px',
    },
    text: {
      fontSize: 'xs',
      color: 'whiteAlpha.700',
      fontStyle: 'italic',
    },
    spinner: {
      size: 'xs',
      color: 'blue.300',
      ml: 0,
    },
    completedIcon: {
      color: 'green.300',
      boxSize: '14px',
      ml: 0,
    },
    errorIcon: {
      color: 'red.300',
      boxSize: '14px',
      ml: 0,
    },
  },
};

export const chatPanelStyles = css`
  .cs-message-list {
    background: var(--chakra-colors-gray-900) !important;
    padding: 12px 10px 22px !important;
  }
  
  .cs-message {
    margin: 6px 0 !important;
  }

  .cs-message__content {
    background-color: rgba(255, 255, 255, .095) !important;
    border: 1px solid rgba(255, 255, 255, .055) !important;
    border-radius: 18px 18px 18px 6px !important;
    padding: 11px 14px !important;
    color: var(--chakra-colors-white) !important;
    font-size: 0.94rem !important;
    line-height: 1.5 !important;
    margin-top: 0 !important;
    box-shadow: 0 3px 12px rgba(0, 0, 0, .1) !important;
  }

  .cs-message__text {
    padding: 0 !important;
    white-space: pre-wrap !important;
    overflow-wrap: anywhere !important;
    word-break: break-word !important;
  }

  .cs-message--outgoing .cs-message__content {
    background: linear-gradient(145deg, rgba(124, 92, 255, .92), rgba(91, 72, 210, .92)) !important;
    border-color: rgba(255, 255, 255, .12) !important;
    border-radius: 18px 18px 6px 18px !important;
  }

  .cs-chat-container {
    background: transparent !important;
    border: 0 !important;
    border-radius: 0 !important;
    padding: 0 !important;
  }

  .cs-main-container {
    border: none !important;
    background: transparent !important;
    width: 100% !important;
    margin-left: 0 !important;
  }

  .cs-message__sender {
    display: none !important;
  }

  .cs-message__content-wrapper {
    max-width: min(84%, 680px) !important;
    margin: 0 6px !important;
    min-width: 0 !important;
  }

  .cs-avatar {
    background-color: var(--chakra-colors-blue-500) !important;
    color: white !important;
    width: 30px !important;
    min-width: 30px !important;
    max-width: 30px !important;
    height: 30px !important;
    min-height: 30px !important;
    max-height: 30px !important;
    flex: 0 0 30px !important;
    aspect-ratio: 1 / 1 !important;
    font-size: 13px !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    border-radius: 50% !important;
    overflow: hidden !important;
  }

  .cs-avatar img,
  .cs-avatar__image {
    width: 100% !important;
    height: 100% !important;
    object-fit: cover !important;
    border-radius: 50% !important;
  }

  .cs-message--outgoing .cs-avatar {
    background-color: var(--chakra-colors-green-500) !important;
  }

  .cs-message__header {
    display: none !important;
  }

  @media (min-width: 1024px) {
    .cs-message-list {
      padding: 14px 16px 22px !important;
    }

    .cs-message {
      margin: 8px 0 !important;
    }

    .cs-message__content-wrapper {
      max-width: 80% !important;
    }
  }

  @media (max-width: 430px) {
    .cs-message-list {
      padding-inline: 8px !important;
    }

    .cs-message {
      margin: 7px 0 !important;
    }

    .cs-message__content-wrapper {
      max-width: calc(100% - 48px) !important;
      margin-inline: 5px !important;
    }

    .cs-message__content {
      padding: 11px 13px !important;
      border-radius: 17px 17px 17px 6px !important;
      font-size: .95rem !important;
    }

    .cs-message--outgoing .cs-message__content {
      border-radius: 17px 17px 6px 17px !important;
    }
  }
`;
