/**
 * MILI design tokens — single source of truth for visual styling.
 *
 * UI-only layer: semantic colors, radii, spacing, typography and control
 * sizes shared by all *-styles files. No behavior, no logic.
 */
export const miliTokens = {
  color: {
    /** App + canvas base. One deep navy everywhere (was gray.900 vs #07111F). */
    background: '#07111F',
    /** Flat panels / bubbles on top of background. */
    surface: 'rgba(255, 255, 255, 0.05)',
    /** Floating bars, cards, drawers. */
    elevated: 'rgba(10, 18, 32, 0.88)',
    /** Nearly-opaque drawer surface (mobile perf: no full-screen blur). */
    drawer: 'rgba(11, 19, 34, 0.985)',
    textPrimary: 'rgba(255, 255, 255, 0.92)',
    textSecondary: 'rgba(255, 255, 255, 0.6)',
    textMuted: 'rgba(255, 255, 255, 0.4)',
    /** Default hairline. */
    border: 'rgba(255, 255, 255, 0.08)',
    /** Emphasized hairline (floating containers). */
    borderStrong: 'rgba(255, 255, 255, 0.12)',
    /** Brand accent. Always flat — never gradient. */
    accent: '#7C5CFF',
    accentSoft: 'rgba(124, 92, 255, 0.16)',
    accentText: '#B9A8FF',
    danger: '#E5484D',
    dangerSoft: 'rgba(229, 72, 77, 0.14)',
    dangerText: '#FF9B9E',
    success: '#3FB96B',
    successSoft: 'rgba(63, 185, 107, 0.14)',
    successText: '#7FDC9B',
    warning: '#E5A13E',
    warningSoft: 'rgba(229, 161, 62, 0.14)',
  },
  radius: {
    sm: '10px',
    md: '14px',
    lg: '20px',
    pill: '999px',
  },
  /** Base spacing unit = 4px. */
  space: {
    1: '4px',
    2: '8px',
    3: '12px',
    4: '16px',
    5: '20px',
    6: '24px',
  },
  font: {
    xs: '12px',
    sm: '13px',
    md: '15px',
    lg: '17px',
    message: '0.925rem',
  },
  /** Touch-first control sizes. */
  control: {
    touch: '44px',
    desktop: '40px',
    composer: '52px',
  },
  shadow: {
    /** Single subtle elevation, used sparingly. */
    float: '0 10px 32px rgba(0, 0, 0, 0.28)',
    none: 'none',
  },
  blur: {
    bar: 'blur(18px)',
    card: 'blur(12px)',
  },
} as const;

export type MiliTokens = typeof miliTokens;
