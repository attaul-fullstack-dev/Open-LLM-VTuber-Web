/* eslint-disable react/require-default-props */
import {
  Box, Textarea, IconButton,
} from '@chakra-ui/react';
import {
  BsMicFill, BsMicMuteFill, BsPaperclip, BsVolumeUpFill, BsVolumeMuteFill,
} from 'react-icons/bs';
import { IoHandRightSharp } from 'react-icons/io5';
import { FiChevronDown } from 'react-icons/fi';
import {
  memo, RefObject, useRef, useState,
} from 'react';
import { FiSend } from 'react-icons/fi';
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

// Single unified composer bar: attach | input | sound | mic | send.
// Same controls on mobile and desktop, only sizes differ.
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

  return (
    <Box {...footerStyles.footer.composerBar}>
      <IconButton
        aria-label="Attach file"
        variant="ghost"
        {...footerStyles.footer.ghostButton}
        color={attachmentCount ? '#B9A8FF' : undefined}
        onClick={() => fileInputRef.current?.click()}
      >
        <BsPaperclip size="19" />
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
      <IconButton
        aria-label={soundOn ? 'Mute avatar voice' : 'Enable avatar voice'}
        variant="ghost"
        {...footerStyles.footer.ghostButton}
        onClick={onSoundToggle}
      >
        {soundOn ? <BsVolumeUpFill size="17" /> : <BsVolumeMuteFill size="17" />}
      </IconButton>
      <IconButton
        aria-label={micOn ? 'Mute microphone' : 'Enable microphone'}
        {...footerStyles.footer.micButton(micOn)}
        onClick={onMicToggle}
      >
        {micOn ? <BsMicFill /> : <BsMicMuteFill />}
      </IconButton>
      <IconButton
        aria-label="Send message"
        {...footerStyles.footer.sendButton}
        onClick={onSend}
      >
        <FiSend size="19" />
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
              {...footerStyles.footer.ghostButton}
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
