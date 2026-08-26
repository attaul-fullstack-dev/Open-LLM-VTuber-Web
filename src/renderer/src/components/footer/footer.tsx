/* eslint-disable react/require-default-props */
import {
  Box, Textarea, IconButton, HStack,
} from '@chakra-ui/react';
import {
  BsMicFill, BsMicMuteFill, BsPaperclip, BsVolumeUpFill, BsVolumeMuteFill,
} from 'react-icons/bs';
import { IoHandRightSharp } from 'react-icons/io5';
import { FiChevronDown } from 'react-icons/fi';
import { memo, useRef, useState } from 'react';
import { FiSend } from 'react-icons/fi';
import { useTranslation } from 'react-i18next';
import { InputGroup } from '@/components/ui/input-group';
import { footerStyles } from './footer-styles';
import AIStateIndicator from './ai-state-indicator';
import { useFooter } from '@/hooks/footer/use-footer';
import { audioManager } from '@/utils/audio-manager';

// Type definitions
interface FooterProps {
  isCollapsed?: boolean
  onToggle?: () => void
}

interface ToggleButtonProps {
  isCollapsed: boolean
  onToggle?: () => void
}

interface ActionButtonsProps {
  micOn: boolean
  soundOn: boolean
  onMicToggle: () => void
  onSoundToggle: () => void
  onInterrupt: () => void
}

interface MessageInputProps {
  value: string
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void
  onCompositionStart: () => void
  onCompositionEnd: () => void
  soundOn?: boolean
  onSoundToggle?: () => void
  onFileSelect?: (files: FileList | null) => void
  attachmentCount?: number
}

// Reusable components
const ToggleButton = memo(({ isCollapsed, onToggle }: ToggleButtonProps) => (
  <Box
    {...footerStyles.footer.toggleButton}
    onClick={onToggle}
    color="whiteAlpha.500"
    style={{
      transform: isCollapsed ? 'rotate(180deg)' : 'rotate(0deg)',
    }}
  >
    <FiChevronDown />
  </Box>
));

ToggleButton.displayName = 'ToggleButton';

const ActionButtons = memo(({
  micOn, soundOn, onMicToggle, onSoundToggle, onInterrupt,
}: ActionButtonsProps) => (
  <HStack gap={2}>
    <IconButton
      bg={micOn ? 'green.500' : 'red.500'}
      {...footerStyles.footer.actionButton}
      onClick={onMicToggle}
    >
      {micOn ? <BsMicFill /> : <BsMicMuteFill />}
    </IconButton>
    <IconButton
      aria-label={soundOn ? 'Mute avatar voice' : 'Enable avatar voice'}
      bg={soundOn ? 'blue.500' : 'gray.600'}
      {...footerStyles.footer.actionButton}
      onClick={onSoundToggle}
    >
      {soundOn ? <BsVolumeUpFill /> : <BsVolumeMuteFill />}
    </IconButton>
    <IconButton
      aria-label="Raise hand"
      bg="yellow.500"
      {...footerStyles.footer.actionButton}
      onClick={onInterrupt}
    >
      <IoHandRightSharp size="24" />
    </IconButton>
  </HStack>
));

ActionButtons.displayName = 'ActionButtons';

const MessageInput = memo(({
  value,
  onChange,
  onKeyDown,
  onCompositionStart,
  onCompositionEnd,
  soundOn,
  onSoundToggle,
  onFileSelect,
  attachmentCount = 0,
}: MessageInputProps) => {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <InputGroup flex={1} minW="0">
      <Box
        display="flex"
        alignItems="center"
        width="100%"
        minW="0"
        height={{ base: '58px', lg: '80px' }}
        px="1"
        bg="gray.700"
        borderRadius={{ base: '30px', lg: '12px' }}
        overflow="hidden"
      >
        <IconButton
          aria-label="Attach file"
          variant="ghost"
          flexShrink={0}
          width="40px"
          minW="40px"
          height="40px"
          borderRadius="full"
          color={attachmentCount ? 'purple.300' : 'whiteAlpha.700'}
          bg="transparent"
          onClick={() => fileInputRef.current?.click()}
        >
          <BsPaperclip size="24" />
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
        {onSoundToggle && (
          <IconButton
            aria-label={soundOn ? 'Mute avatar voice' : 'Enable avatar voice'}
            flexShrink={0}
            width="40px"
            minW="40px"
            height="40px"
            borderRadius="full"
            color={soundOn ? 'blue.300' : 'whiteAlpha.500'}
            bg="transparent"
            _hover={{ bg: 'whiteAlpha.100' }}
            onClick={onSoundToggle}
          >
            {soundOn ? <BsVolumeUpFill /> : <BsVolumeMuteFill />}
          </IconButton>
        )}
      </Box>
    </InputGroup>
  );
});

MessageInput.displayName = 'MessageInput';

// Main component
function Footer({ isCollapsed = false, onToggle }: FooterProps): JSX.Element {
  const [soundOn, setSoundOn] = useState(() => !audioManager.isMuted());
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
  } = useFooter();

  const handleSoundToggle = () => {
    const nextSoundOn = !soundOn;
    audioManager.setMuted(!nextSoundOn);
    setSoundOn(nextSoundOn);
  };

  return (
    <Box {...footerStyles.footer.container(isCollapsed)}>
      <ToggleButton isCollapsed={isCollapsed} onToggle={onToggle} />

      <Box display={{ base: 'none', lg: 'block' }} pt="0" px="4">
        <HStack width="100%" gap={4}>
          <Box>
            <Box mb="1.5">
              <AIStateIndicator />
            </Box>
            <ActionButtons
              micOn={micOn}
              soundOn={soundOn}
              onMicToggle={handleMicToggle}
              onSoundToggle={handleSoundToggle}
              onInterrupt={handleInterrupt}
            />
          </Box>

          <MessageInput
            value={inputValue}
            onChange={handleInputChange}
            onKeyDown={handleKeyPress}
            onCompositionStart={handleCompositionStart}
            onCompositionEnd={handleCompositionEnd}
            onFileSelect={handleFileSelect}
            attachmentCount={attachmentCount}
          />
        </HStack>
      </Box>

      <Box display={{ base: 'block', lg: 'none' }} px="2" pb="2">
        <HStack width="100%" gap={2}>
          <IconButton
            aria-label={micOn ? 'Mute microphone' : 'Enable microphone'}
            bg={micOn ? 'green.500' : 'red.500'}
            {...footerStyles.footer.actionButton}
            onClick={handleMicToggle}
          >
            {micOn ? <BsMicFill /> : <BsMicMuteFill />}
          </IconButton>
          <MessageInput
            value={inputValue}
            onChange={handleInputChange}
            onKeyDown={handleKeyPress}
            onCompositionStart={handleCompositionStart}
            onCompositionEnd={handleCompositionEnd}
            soundOn={soundOn}
            onSoundToggle={handleSoundToggle}
            onFileSelect={handleFileSelect}
            attachmentCount={attachmentCount}
          />
          <IconButton
            aria-label="Send message"
            bg="purple.500"
            {...footerStyles.footer.actionButton}
            onClick={handleSend}
          >
            <FiSend size="21" />
          </IconButton>
        </HStack>
      </Box>
    </Box>
  );
}

export default Footer;
