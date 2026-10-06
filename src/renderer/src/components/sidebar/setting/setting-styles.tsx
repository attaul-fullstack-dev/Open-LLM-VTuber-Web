import { miliTokens } from '@/theme/design-tokens';

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
      // One tab system: quiet labels, subtle accent on the active tab only.
      trigger: {
        color: miliTokens.color.textMuted,
        flexShrink: 0,
        px: { base: 3, lg: 4 },
        py: { base: 2, lg: 3 },
        fontSize: { base: 'sm', lg: 'md' },
        borderRadius: miliTokens.radius.sm,
        _selected: {
          color: miliTokens.color.accentText,
          boxShadow: `inset 0 -2px 0 ${miliTokens.color.accent}`,
        },
        _hover: {
          color: miliTokens.color.textPrimary,
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
        borderColor: miliTokens.color.border,
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
      bg: miliTokens.color.drawer,
      width: { base: '84vw', sm: '340px', lg: '440px' },
      maxWidth: { base: '84vw', sm: '340px', lg: '440px' },
      height: isElectron ? 'calc(100dvh - 30px)' : '100dvh',
      overflow: 'hidden',
      borderLeft: '1px solid',
      borderColor: miliTokens.color.border,
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
      color: miliTokens.color.textPrimary,
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
      borderColor: miliTokens.color.border,
      bg: miliTokens.color.drawer,
      '& button': {
        flex: { base: 1, lg: 'initial' },
        minW: { base: '84px', lg: '96px' },
        height: { base: '40px', lg: '44px' },
      },
    },
    // Intentional action bar: Save is the single primary action, Cancel is
    // a quiet secondary. Neither dominates the panel.
    cancelButton: {
      variant: 'ghost' as const,
      color: miliTokens.color.textSecondary,
      _hover: { bg: miliTokens.color.surface, color: miliTokens.color.textPrimary },
      _active: { bg: miliTokens.color.surface },
    },
    saveButton: {
      variant: 'solid' as const,
      bg: miliTokens.color.accent,
      color: 'white',
      _hover: { filter: 'brightness(1.1)' },
      _active: { filter: 'brightness(1.15)' },
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
        color: miliTokens.color.textSecondary,
      },
    },
    select: {
      root: {
        colorPalette: 'gray',
      },
      trigger: {
        bg: miliTokens.color.surface,
        borderColor: miliTokens.color.border,
        _hover: {
          bg: 'whiteAlpha.100',
        },
      },
    },
    input: {
      bg: miliTokens.color.surface,
      borderColor: miliTokens.color.border,
      _hover: {
        bg: 'whiteAlpha.100',
      },
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
      color: miliTokens.color.textSecondary,
    },
  },
  common: {
    field: {
      orientation: 'horizontal' as const,
    },
    fieldLabel: {
      fontSize: 'sm',
      color: miliTokens.color.textSecondary,
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
        bg: miliTokens.color.surface,
        borderColor: miliTokens.color.border,
        _hover: {
          bg: 'whiteAlpha.100',
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
      bg: miliTokens.color.surface,
      borderColor: miliTokens.color.border,
      _hover: {
        bg: 'whiteAlpha.100',
      },
    },
  },
  // Settings section: quiet uppercase title + rows. Grouping comes from
  // spacing and the title — never from cards or extra borders.
  section: {
    container: {
      gap: 4,
      width: '100%',
    },
    title: {
      fontSize: miliTokens.font.xs,
      fontWeight: 'semibold',
      letterSpacing: '0.08em',
      textTransform: 'uppercase' as const,
      color: miliTokens.color.textMuted,
    },
  },
  // Intentional empty state for tabs with no configurable content yet.
  // Subtle and honest: never fake settings.
  emptyState: {
    container: {
      display: 'flex',
      flexDirection: 'column' as const,
      alignItems: 'center',
      justifyContent: 'center',
      textAlign: 'center' as const,
      gap: 2,
      py: 10,
      px: 4,
    },
    title: {
      fontSize: miliTokens.font.md,
      fontWeight: 'semibold',
      color: miliTokens.color.textSecondary,
    },
    body: {
      fontSize: miliTokens.font.sm,
      color: miliTokens.color.textMuted,
      lineHeight: '1.5',
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
