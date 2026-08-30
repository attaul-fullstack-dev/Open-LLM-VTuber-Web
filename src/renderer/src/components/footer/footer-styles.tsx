import { SystemStyleObject } from '@chakra-ui/react';

interface FooterStyles {
  container: (isCollapsed: boolean) => SystemStyleObject
  toggleButton: SystemStyleObject
  actionButton: SystemStyleObject
  input: SystemStyleObject
  attachButton: SystemStyleObject
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
      bg: isCollapsed ? 'transparent' : { base: 'rgba(10, 18, 31, .88)', lg: 'gray.800' },
      backdropFilter: { base: 'blur(18px)', lg: 'none' },
      borderRadius: isCollapsed ? 'none' : { base: '28px', lg: '16px 16px 0 0' },
      border: isCollapsed ? 'none' : { base: '1px solid rgba(255,255,255,.12)', lg: 'none' },
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
      pb: { base: '0', lg: '4' },
      boxShadow: isCollapsed ? 'none' : { base: '0 12px 36px rgba(0,0,0,.28)', lg: 'none' },
    }),
    toggleButton: {
      height: { base: '7px', lg: '24px' },
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      cursor: 'pointer',
      color: 'whiteAlpha.700',
      _hover: { color: 'white' },
      bg: 'transparent',
      transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
    },
    actionButton: {
      borderRadius: { base: 'full', lg: '12px' },
      width: { base: '44px', lg: '50px' },
      height: { base: '44px', lg: '50px' },
      minW: { base: '44px', lg: '50px' },
      flexShrink: 0,
      position: 'relative',
      zIndex: 2,
      pointerEvents: 'auto',
      touchAction: 'manipulation',
      boxShadow: { base: '0 4px 14px rgba(0,0,0,.18)', lg: 'none' },
    },
    input: {
      bg: 'transparent',
      border: 'none',
      height: { base: '52px', lg: '80px' },
      borderRadius: '0',
      fontSize: { base: '15px', lg: '18px' },
      pl: { base: '1.5', lg: '2' },
      pr: { base: '1', lg: '2' },
      color: 'whiteAlpha.900',
      _placeholder: {
        color: 'whiteAlpha.500',
      },
      _focus: {
        border: 'none',
        bg: 'transparent',
      },
      resize: 'none',
      minHeight: { base: '52px', lg: '80px' },
      maxHeight: { base: '52px', lg: '80px' },
      py: { base: '14px', lg: '24px' },
      lineHeight: '1.4',
      whiteSpace: 'pre-wrap',
      overflowY: 'auto',
      overflowX: 'hidden',
    },
    attachButton: {
      position: 'absolute',
      left: '1',
      top: '50%',
      transform: 'translateY(-50%)',
      color: 'whiteAlpha.700',
      zIndex: 2,
      _hover: {
        bg: 'transparent',
        color: 'white',
      },
    },
  },
  aiIndicator: {
    container: {
      bg: '#7C5CFF',
      color: 'white',
      width: '110px',
      height: '30px',
      borderRadius: '12px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      boxShadow: '0 2px 6px rgba(0,0,0,0.1)',
      overflow: 'hidden',
    },
    text: {
      fontSize: '12px',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
    },
  },
};
