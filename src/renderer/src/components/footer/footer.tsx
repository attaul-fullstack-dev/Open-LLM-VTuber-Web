/* eslint-disable react/require-default-props */
import {
  Box, Textarea, IconButton,
} from '@chakra-ui/react';
import {
  FiPlus, FiMic, FiMicOff, FiVolume2, FiVolumeX, FiArrowUp, FiChevronDown,
} from 'react-icons/fi';
import { IoHandRightSharp } from 'react-icons/io5';
import {
  memo, RefObject, useEffect, useRef, useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { footerStyles } from './footer-styles';
import AIStateIndicator from './ai-state-indicator';
import { useFooter } from '@/hooks/footer/use-footer';
import { audioManager } from '@/utils/audio-manager';
import { useAvatarActivityState } from '@/context/avatar-activity-context';

// Type definitions
interface FooterProps {
  isCollapsed?: boolean
  onToggle?: () => void
}

interface ToggleButtonProps {
  isCollapsed: boolean
  onToggle?: () => void
}

interface ComposerBarProps {
  value: string
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void
  onCompositionStart: () => void
  onCompositionEnd: () => void
  micOn: boolean
  soundOn: boolean
  onMicToggle: () => void
  onSoundToggle: () => void
  onSend: () => void
  onFileSelect?: (files: FileList | null) => void
  attachmentCount?: number
  inputRef: RefObject<HTMLTextAreaElement>
}

// Visual-only cap for auto-expand; beyond this the textarea scrolls.
const INPUT_MAX_HEIGHT = 132;

// Reusable components
const ToggleButton = memo(({ isCollapsed, onToggle }: ToggleButtonProps) => (
  <Box
    {...footerStyles.footer.toggleButton}
    onClick={onToggle}
    style={{
      transform: isCollapsed ? 'rotate(180deg)' : 'rotate(0deg)',
    }}
  >
    <FiChevronDown />
  </Box>
));

ToggleButton.displayName = 'ToggleButton';

// Single unified composer bar: + | input | speaker | mic | SEND.
// All icons come from one Feather set for consistent stroke. Behavior
// (handlers, refs, send flow) is untouched; only visuals + auto-expand.
const ComposerBar = memo(({
  value,
  onChange,
  onKeyDown,
  onCompositionStart,
  onCompositionEnd,
  micOn,
  soundOn,
  onMicToggle,
  onSoundToggle,
  onSend,
  onFileSelect,
  attachmentCount = 0,
  inputRef,
}: ComposerBarProps) => {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-expand: grow with content between one line and INPUT_MAX_HEIGHT.
  // Width, icons and bar position never change, so typing cannot jitter.
  // An empty box falls back to the CSS single-line min-height: an empty
  // textarea reports a larger scrollHeight quirk (44px vs 40px filled),
  // which would shift the bar by 4px the moment typing starts.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    if (!value) {
      el.style.height = '';
      return;
    }
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, INPUT_MAX_HEIGHT)}px`;
  }, [value, inputRef]);

  return (
    <Box {...footerStyles.footer.composerBar}>
      <IconButton
        aria-label="Attach file"
        variant="ghost"
        {...footerStyles.footer.attachButton(attachmentCount > 0)}
        onClick={() => fileInputRef.current?.click()}
      >
        <FiPlus size="21" />
      </IconButton>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(event) => {
          onFileSelect?.(event.target.files);
          event.target.value = '';
        }}
      />
      <Box {...footerStyles.footer.divider} />
      <Textarea
        ref={inputRef}
        rows={1}
        value={value}
        onChange={onChange}
        onKeyDown={onKeyDown}
        onCompositionStart={onCompositionStart}
        onCompositionEnd={onCompositionEnd}
        placeholder={t('footer.typeYourMessage')}
        {...footerStyles.footer.input}
        flex="1"
        minW="0"
      />
      <Box {...footerStyles.footer.divider} />
      <IconButton
        aria-label={soundOn ? 'Mute avatar voice' : 'Enable avatar voice'}
        variant="ghost"
        {...footerStyles.footer.soundButton(soundOn)}
        onClick={onSoundToggle}
      >
        {soundOn ? <FiVolume2 size="20" /> : <FiVolumeX size="20" />}
      </IconButton>
      <Box {...footerStyles.footer.divider} />
      <IconButton
        aria-label={micOn ? 'Mute microphone' : 'Enable microphone'}
        variant="ghost"
        {...footerStyles.footer.micButton(micOn)}
        onClick={onMicToggle}
      >
        {micOn ? <FiMic size="20" /> : <FiMicOff size="20" />}
      </IconButton>
      <IconButton
        aria-label="Send message"
        {...footerStyles.footer.sendButton}
        onClick={onSend}
      >
        <FiArrowUp size="21" strokeWidth={2.5} />
      </IconButton>
    </Box>
  );
});

ComposerBar.displayName = 'ComposerBar';

// Main component
function Footer({ isCollapsed = false, onToggle }: FooterProps): JSX.Element {
  const [soundOn, setSoundOn] = useState(() => !audioManager.isMuted());
  const { endAllSpeaking } = useAvatarActivityState();
  const {
    inputValue,
    handleInputChange,
    handleKeyPress,
    handleCompositionStart,
    handleCompositionEnd,
    handleInterrupt,
    handleMicToggle,
    micOn,
    handleSend,
    handleFileSelect,
    attachmentCount,
    inputRef,
  } = useFooter();

  const handleSoundToggle = () => {
    const nextSoundOn = !soundOn;
    audioManager.setMuted(!nextSoundOn);
    if (!nextSoundOn) endAllSpeaking();
    setSoundOn(nextSoundOn);
  };

  return (
    <Box {...footerStyles.footer.container(isCollapsed)}>
      <ToggleButton isCollapsed={isCollapsed} onToggle={onToggle} />

      {!isCollapsed && (
        <>
          <Box {...footerStyles.footer.utilityRow}>
            <AIStateIndicator />
            <IconButton
              aria-label="Interrupt"
              title="Interrupt"
              variant="ghost"
              {...footerStyles.footer.utilityButton}
              width={{ base: '32px', lg: '36px' }}
              minW={{ base: '32px', lg: '36px' }}
              height={{ base: '28px', lg: '32px' }}
              onClick={handleInterrupt}
            >
              <IoHandRightSharp size="15" />
            </IconButton>
          </Box>

          <ComposerBar
            value={inputValue}
            onChange={handleInputChange}
            onKeyDown={handleKeyPress}
            onCompositionStart={handleCompositionStart}
            onCompositionEnd={handleCompositionEnd}
            micOn={micOn}
            soundOn={soundOn}
            onMicToggle={handleMicToggle}
            onSoundToggle={handleSoundToggle}
            onSend={handleSend}
            onFileSelect={handleFileSelect}
            attachmentCount={attachmentCount}
            inputRef={inputRef}
          />
        </>
      )}
    </Box>
  );
}

export default Footer;
