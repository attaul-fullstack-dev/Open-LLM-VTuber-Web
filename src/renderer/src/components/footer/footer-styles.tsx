import { SystemStyleObject } from '@chakra-ui/react';
import { miliTokens } from '@/theme/design-tokens';

interface FooterStyles {
  container: (isCollapsed: boolean) => SystemStyleObject
  toggleButton: SystemStyleObject
  /** Slim row above the bar: status text left, interrupt ghost right. */
  utilityRow: SystemStyleObject
  statusText: SystemStyleObject
  /** Single unified composer bar. */
  composerBar: SystemStyleObject
  ghostButton: SystemStyleObject
  micButton: (micOn: boolean) => SystemStyleObject
  sendButton: SystemStyleObject
  input: SystemStyleObject
}

interface AIIndicatorStyles {
  container: SystemStyleObject
  text: SystemStyleObject
}

export const footerStyles: {
  footer: FooterStyles
  aiIndicator: AIIndicatorStyles
} = {
  footer: {
    container: (isCollapsed) => ({
      bg: isCollapsed ? 'transparent' : { base: miliTokens.color.elevated, lg: miliTokens.color.background },
      backdropFilter: { base: miliTokens.blur.bar, lg: 'none' },
      borderRadius: isCollapsed ? 'none' : { base: miliTokens.radius.lg, lg: '0' },
      border: isCollapsed ? 'none' : { base: '1px solid', lg: 'none' },
      borderColor: isCollapsed ? undefined : { base: miliTokens.color.borderStrong, lg: undefined },
      borderTop: isCollapsed ? undefined : { base: undefined, lg: `1px solid ${miliTokens.color.border}` },
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
      boxShadow: isCollapsed ? 'none' : { base: miliTokens.shadow.float, lg: 'none' },
    }),
    toggleButton: {
      height: { base: '7px', lg: '20px' },
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      cursor: 'pointer',
      color: miliTokens.color.textMuted,
      _hover: { color: miliTokens.color.textPrimary },
      bg: 'transparent',
      transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
    },
    utilityRow: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      px: { base: '6px', lg: '2px' },
      pb: '2px',
      minH: '26px',
      // When the status text hides (thinking pill takes over), keep
      // the interrupt button pinned right.
      '& > :last-child': { marginLeft: 'auto' },
    },
    statusText: {
      fontSize: miliTokens.font.xs,
      color: miliTokens.color.textSecondary,
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
    },
    composerBar: {
      display: 'flex',
      alignItems: 'center',
      width: '100%',
      minW: '0',
      height: { base: '50px', lg: '56px' },
      px: { base: '1', lg: '1.5' },
      gap: '1px',
      bg: miliTokens.color.surface,
      border: '1px solid',
      borderColor: miliTokens.color.border,
      borderRadius: miliTokens.radius.pill,
      overflow: 'hidden',
    },
    ghostButton: {
      flexShrink: 0,
      width: { base: '36px', lg: '40px' },
      minW: { base: '36px', lg: '40px' },
      height: { base: '36px', lg: '40px' },
      borderRadius: 'full',
      color: miliTokens.color.textSecondary,
      bg: 'transparent',
      _hover: { bg: miliTokens.color.surface, color: miliTokens.color.textPrimary },
      _active: { bg: miliTokens.color.surface },
    },
    micButton: (micOn) => ({
      flexShrink: 0,
      width: { base: miliTokens.control.touch, lg: miliTokens.control.desktop },
      minW: { base: miliTokens.control.touch, lg: miliTokens.control.desktop },
      height: { base: miliTokens.control.touch, lg: miliTokens.control.desktop },
      borderRadius: 'full',
      color: micOn ? miliTokens.color.successText : miliTokens.color.dangerText,
      bg: micOn ? miliTokens.color.successSoft : miliTokens.color.dangerSoft,
      _hover: { filter: 'brightness(1.15)' },
      _active: { filter: 'brightness(1.25)' },
    }),
    sendButton: {
      flexShrink: 0,
      width: { base: miliTokens.control.touch, lg: miliTokens.control.desktop },
      minW: { base: miliTokens.control.touch, lg: miliTokens.control.desktop },
      height: { base: miliTokens.control.touch, lg: miliTokens.control.desktop },
      borderRadius: 'full',
      color: 'white',
      bg: miliTokens.color.accent,
      _hover: { filter: 'brightness(1.12)' },
      _active: { filter: 'brightness(1.2)' },
      _disabled: { opacity: 0.45 },
    },
    input: {
      bg: 'transparent',
      border: 'none',
      height: { base: '50px', lg: '56px' },
      borderRadius: '0',
      fontSize: { base: miliTokens.font.md, lg: miliTokens.font.lg },
      pl: { base: '1.5', lg: '2' },
      pr: { base: '1', lg: '2' },
      color: miliTokens.color.textPrimary,
      _placeholder: {
        color: miliTokens.color.textMuted,
      },
      _focus: {
        border: 'none',
        bg: 'transparent',
      },
      resize: 'none',
      minHeight: { base: '50px', lg: '56px' },
      maxHeight: { base: '50px', lg: '56px' },
      py: { base: '13px', lg: '16px' },
      lineHeight: '1.4',
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
