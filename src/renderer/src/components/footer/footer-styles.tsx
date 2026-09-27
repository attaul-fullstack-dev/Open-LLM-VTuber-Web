import { SystemStyleObject } from '@chakra-ui/react';
import { miliTokens } from '@/theme/design-tokens';

interface FooterStyles {
  container: (isCollapsed: boolean) => SystemStyleObject
  /** Single unified composer bar. Grows vertically with multi-line input. */
  composerBar: SystemStyleObject
  /** 1px warm-neutral separator between composer sections. */
  divider: SystemStyleObject
  attachButton: (hasAttachment: boolean) => SystemStyleObject
  soundButton: (soundOn: boolean) => SystemStyleObject
  micButton: (micOn: boolean) => SystemStyleObject
  sendButton: SystemStyleObject
  input: SystemStyleObject
}

interface AIIndicatorStyles {
  container: SystemStyleObject
  text: SystemStyleObject
}

const composer = miliTokens.composer;

export const footerStyles: {
  footer: FooterStyles
  aiIndicator: AIIndicatorStyles
} = {
  footer: {
    container: (isCollapsed) => ({
      // The composer is a single visual unit: no panel background, border,
      // radius, shadow or blur on the wrapper. Positioning, safe-area
      // padding and the collapse transform are preserved.
      bg: 'transparent',
      backdropFilter: 'none',
      borderRadius: 'none',
      border: 'none',
      transform: isCollapsed
        ? { base: 'translateY(calc(100% - 10px))', lg: 'translateY(calc(100% - 24px))' }
        : 'translateY(0)',
      transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
      height: '100%',
      position: 'relative',
      zIndex: 1,
      pointerEvents: 'auto',
      touchAction: 'manipulation',
      overflow: 'hidden',
      px: { base: '1.5', lg: '4' },
      pb: { base: '1.5', lg: '3' },
      boxShadow: 'none',
    }),
    composerBar: {
      display: 'flex',
      alignItems: 'center',
      width: '100%',
      minW: '0',
      maxW: { base: '100%', lg: '760px' },
      mx: { base: '0', lg: 'auto' },
      minHeight: { base: '54px', lg: '58px' },
      px: { base: '4px', lg: '8px' },
      py: { base: '5px', lg: '6px' },
      gap: '0',
      bg: composer.bg,
      border: '1px solid',
      borderColor: composer.border,
      borderRadius: '20px',
      overflow: 'hidden',
    },
    divider: {
      flexShrink: 0,
      width: '1px',
      alignSelf: 'stretch',
      my: '12px',
      bg: composer.divider,
    },
    attachButton: (hasAttachment) => ({
      flexShrink: 0,
      width: { base: '40px', lg: '40px' },
      minW: { base: '40px', lg: '40px' },
      height: { base: '40px', lg: '40px' },
      borderRadius: 'full',
      color: hasAttachment ? composer.accent : composer.icon,
      bg: 'transparent',
      _hover: { bg: composer.iconHoverBg, color: composer.text },
      _active: { bg: composer.iconHoverBg },
    }),
    soundButton: (soundOn) => ({
      flexShrink: 0,
      width: { base: '40px', lg: '40px' },
      minW: { base: '40px', lg: '40px' },
      height: { base: '40px', lg: '40px' },
      borderRadius: 'full',
      color: soundOn ? composer.icon : composer.iconMuted,
      bg: 'transparent',
      _hover: { bg: composer.iconHoverBg, color: composer.text },
      _active: { bg: composer.iconHoverBg },
    }),
    micButton: (micOn) => ({
      flexShrink: 0,
      width: { base: '40px', lg: '40px' },
      minW: { base: '40px', lg: '40px' },
      height: { base: '40px', lg: '40px' },
      borderRadius: 'full',
      color: micOn ? composer.accent : composer.iconMuted,
      bg: micOn ? composer.micActiveBg : 'transparent',
      _hover: { bg: micOn ? composer.micActiveBg : composer.iconHoverBg, color: micOn ? composer.accent : composer.text },
      _active: { bg: micOn ? composer.micActiveBg : composer.iconHoverBg },
    }),
    sendButton: {
      flexShrink: 0,
      width: miliTokens.control.touch,
      minW: miliTokens.control.touch,
      height: miliTokens.control.touch,
      borderRadius: 'full',
      color: composer.accentInk,
      bg: composer.accent,
      ml: '2px',
      _hover: { filter: 'brightness(1.07)' },
      _active: { filter: 'brightness(1.12)' },
      _disabled: { opacity: 0.45 },
    },
    input: {
      bg: 'transparent',
      border: 'none',
      outline: 'none',
      borderRadius: '0',
      fontSize: { base: miliTokens.font.md, lg: '16px' },
      pl: { base: '1.5', lg: '2.5' },
      pr: '0.5',
      py: '0',
      color: composer.text,
      _placeholder: {
        color: composer.placeholder,
        whiteSpace: 'nowrap',
      },
      _focus: {
        border: 'none',
        outline: 'none',
        bg: 'transparent',
      },
      _focusVisible: {
        outline: 'none',
        boxShadow: 'none',
        border: 'none',
      },
      resize: 'none',
      // minHeight 0: scrollHeight then reports the exact content height, so
      // a single line is always exactly one line-height tall and centered
      // by the bar (a CSS minimum would pad slack below the text).
      minHeight: '0',
      maxHeight: '132px',
      lineHeight: '1.45',
      whiteSpace: 'pre-wrap',
      overflowY: 'auto',
      overflowX: 'hidden',
    },
  },
  aiIndicator: {
    container: {
      display: 'flex',
      alignItems: 'center',
      minW: '0',
    },
    text: {
      fontSize: miliTokens.font.xs,
      color: miliTokens.color.textSecondary,
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
    },
  },
};
