const isElectron = window.api !== undefined;
export const settingStyles = {
  settingUI: {
    container: {
      width: '100%',
      height: '100%',
      p: 4,
      gap: 4,
      position: 'relative',
      overflowY: 'auto',
      css: {
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
    },
    header: {
      width: '100%',
      display: 'flex',
      alignItems: 'center',
      gap: 1,
    },
    title: {
      ml: 4,
      fontSize: 'lg',
      fontWeight: 'bold',
    },
    tabs: {
      root: {
        width: '100%',
        variant: 'plain' as const,
        colorPalette: 'gray',
      },
      content: {},
      trigger: {
        color: 'whiteAlpha.600',
        flexShrink: 0,
        px: { base: 3, lg: 4 },
        py: { base: 2, lg: 3 },
        fontSize: { base: 'sm', lg: 'md' },
        _selected: {
          color: 'white',
        },
        _hover: {
          color: 'white',
        },
      },
      list: {
        display: 'flex',
        justifyContent: 'flex-start',
        width: '100%',
        overflowX: 'auto',
        overflowY: 'hidden',
        scrollSnapType: 'x proximity',
        borderBottom: '1px solid',
        borderColor: 'whiteAlpha.200',
        mb: { base: 3, lg: 4 },
        pl: 0,
        css: {
          scrollbarWidth: 'none',
          '&::-webkit-scrollbar': { display: 'none' },
        },
      },
    },
    footer: {
      width: '100%',
      display: 'flex',
      justifyContent: 'flex-end',
      gap: 2,
      mt: 'auto',
      pt: 4,
      borderTop: '1px solid',
      borderColor: 'whiteAlpha.200',
    },
    drawerContent: {
      bg: 'gray.900',
      width: { base: '84vw', sm: '340px', lg: '440px' },
      maxWidth: { base: '84vw', sm: '340px', lg: '440px' },
      height: isElectron ? 'calc(100dvh - 30px)' : '100dvh',
      overflow: 'hidden',
      borderLeft: '1px solid',
      borderColor: 'whiteAlpha.200',
    },
    drawerHeader: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      width: '100%',
      position: 'relative',
      px: { base: 4, lg: 6 },
      py: { base: 3, lg: 4 },
    },
    drawerTitle: {
      color: 'white',
      fontSize: { base: 'md', lg: 'lg' },
      fontWeight: 'semibold',
    },
    drawerBody: {
      px: { base: 4, lg: 6 },
      pr: { base: 5, lg: 6 },
      pb: 3,
      overflowX: 'hidden',
    },
    drawerFooter: {
      px: { base: 4, lg: 6 },
      pr: { base: 5, lg: 6 },
      py: { base: 3, lg: 4 },
      gap: 2,
      borderTop: '1px solid',
      borderColor: 'whiteAlpha.200',
      bg: 'rgba(17, 24, 39, .96)',
      backdropFilter: 'blur(12px)',
      '& button': {
        flex: { base: 1, lg: 'initial' },
        minW: { base: '84px', lg: '96px' },
        height: { base: '40px', lg: '44px' },
      },
    },
    closeButton: {
      display: { base: 'none', lg: 'block' },
      position: 'absolute',
      right: 1,
      top: 1,
      color: 'white',

    },
  },
  general: {
    container: {
      align: 'stretch',
      gap: { base: 4, lg: 6 },
      p: { base: 1, lg: 4 },
    },
    field: {
      label: {
        color: 'whiteAlpha.800',
      },
    },
    select: {
      root: {
        colorPalette: 'gray',
        bg: 'gray.800',
      },
      trigger: {
        bg: 'gray.800',
      },
    },
    input: {
      bg: 'gray.800',
    },
    buttonGroup: {
      gap: 4,
      width: '100%',
    },
    button: {
      width: '50%',
      variant: 'outline' as const,
      bg: 'blue',
      color: 'white',
      _hover: {
        bg: 'whiteAlpha.300',
      },
    },
    fieldLabel: {
      fontSize: '14px',
      color: 'gray.600',
    },
  },
  common: {
    field: {
      orientation: 'horizontal' as const,
    },
    fieldLabel: {
      fontSize: 'sm',
      color: 'whiteAlpha.800',
      whiteSpace: 'normal' as const,
      lineHeight: '1.35',
    },
    switch: {
      size: 'md' as const,
      colorPalette: 'blue' as const,
      variant: 'solid' as const,
    },
    numberInput: {
      root: {
        pattern: '[0-9]*\\.?[0-9]*',
        inputMode: 'decimal' as const,
      },
      input: {
        bg: 'whiteAlpha.100',
        borderColor: 'whiteAlpha.200',
        _hover: {
          bg: 'whiteAlpha.200',
        },
      },
    },
    container: {
      gap: { base: 5, lg: 8 },
      width: '100%',
      maxW: 'sm',
      pr: { base: 1, lg: 0 },
      css: { '--field-label-width': '120px' },
    },
    input: {
      bg: 'whiteAlpha.100',
      borderColor: 'whiteAlpha.200',
      _hover: {
        bg: 'whiteAlpha.200',
      },
    },
  },
  live2d: {
    container: {
      gap: 8,
      maxW: 'sm',
      css: { '--field-label-width': '120px' },
    },
    emotionMap: {
      title: {
        fontWeight: 'bold',
        mb: 4,
      },
      entry: {
        mb: 2,
      },
      button: {
        colorPalette: 'blue',
        mt: 2,
      },
      deleteButton: {
        colorPalette: 'red',
      },
    },
  },
};
