import {
  createContext, useState, useMemo, useContext, memo, useCallback,
} from 'react';

const SUBTITLE_VISIBILITY_KEY = 'olvShowSubtitle';

/**
 * Subtitle context state interface
 * @interface SubtitleState
 */
interface SubtitleState {
  /** Current subtitle text */
  subtitleText: string

  /** Set subtitle text */
  setSubtitleText: (text: string) => void

  /** Whether to show subtitle */
  showSubtitle: boolean

  /** Toggle subtitle visibility */
  setShowSubtitle: (show: boolean) => void

  /** Hide subtitles only for the response that is currently playing */
  subtitleDismissed: boolean
  dismissSubtitle: () => void
  startSubtitleResponse: () => void
}

/**
 * Default values and constants
 */
const DEFAULT_SUBTITLE = { text: '' };

/**
 * Create the subtitle context
 */
export const SubtitleContext = createContext<SubtitleState | null>(null);

/**
 * Subtitle Provider Component
 * Manages the subtitle display text state
 *
 * @param {Object} props - Provider props
 * @param {React.ReactNode} props.children - Child components
 */
export const SubtitleProvider = memo(({ children }: { children: React.ReactNode }) => {
  // State management
  const [subtitleText, setSubtitleText] = useState<string>(DEFAULT_SUBTITLE.text);
  const [showSubtitle, setShowSubtitleState] = useState<boolean>(() => (
    localStorage.getItem(SUBTITLE_VISIBILITY_KEY) !== 'false'
  ));
  const [subtitleDismissed, setSubtitleDismissed] = useState(false);

  const setShowSubtitle = useCallback((show: boolean) => {
    setShowSubtitleState(show);
    localStorage.setItem(SUBTITLE_VISIBILITY_KEY, String(show));
  }, []);

  const dismissSubtitle = useCallback(() => {
    setSubtitleDismissed(true);
    setSubtitleText('');
  }, []);

  const startSubtitleResponse = useCallback(() => {
    setSubtitleDismissed(false);
    setSubtitleText('');
  }, []);

  // Memoized context value
  const contextValue = useMemo(
    () => ({
      subtitleText,
      setSubtitleText,
      showSubtitle,
      setShowSubtitle,
      subtitleDismissed,
      dismissSubtitle,
      startSubtitleResponse,
    }),
    [subtitleText, showSubtitle, subtitleDismissed, dismissSubtitle, startSubtitleResponse],
  );

  return (
    <SubtitleContext.Provider value={contextValue}>
      {children}
    </SubtitleContext.Provider>
  );
});

/**
 * Custom hook to use the subtitle context
 * @throws {Error} If used outside of SubtitleProvider
 */
export function useSubtitle() {
  const context = useContext(SubtitleContext);

  if (!context) {
    throw new Error('useSubtitle must be used within a SubtitleProvider');
  }

  return context;
}
