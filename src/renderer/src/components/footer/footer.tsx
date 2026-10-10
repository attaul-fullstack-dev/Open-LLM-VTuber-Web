/* eslint-disable react/require-default-props */
import {
  Box, Textarea, IconButton, Text,
} from '@chakra-ui/react';
import {
  FiPlus, FiMic, FiMicOff, FiVolume2, FiVolumeX, FiArrowUp, FiX,
} from 'react-icons/fi';
import {
  memo, RefObject, useEffect, useRef, useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { footerStyles } from './footer-styles';
import { miliTokens } from '@/theme/design-tokens';
import { getComposerMode } from '@/utils/composer-visibility';
import { useFooter } from '@/hooks/footer/use-footer';
import { audioManager } from '@/utils/audio-manager';
import { useAvatarActivityState } from '@/context/avatar-activity-context';
import { AttachmentEntry, formatFileSize } from '@/utils/attachments';

// Type definitions
interface FooterProps {
  isCollapsed?: boolean
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
  onRemoveAttachment?: (id: string) => void
  attachments?: AttachmentEntry[]
  attachmentCount?: number
  inputRef: RefObject<HTMLTextAreaElement>
}

// Visual-only cap for auto-expand; beyond this the textarea scrolls.
const INPUT_MAX_HEIGHT = 132;

// Reusable components
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
  onRemoveAttachment,
  attachments = [],
  attachmentCount = 0,
  inputRef,
}: ComposerBarProps) => {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Hidden wrap counter. Width is locked to the compact textarea content
  // width (bar minus fixed controls ≈ 185px) and never changes with the
  // active mode, so the expanded decision is layout-independent.
  const measureRef = useRef<HTMLDivElement>(null);

  // Auto-expand + mode, both measured — no behavior changes.
  // - textarea height: exact content height in the CURRENT layout.
  // - expanded mode: visual lines counted on a hidden measurer whose
  //   width is fixed to the compact textarea width. Because the metric
  //   never depends on the active layout, mode can never oscillate:
  //   wrapped long text also moves to the bottom control row, and
  //   deleting back always returns to the compact row.
  const [measuredExpanded, setMeasuredExpanded] = useState(false);
  useEffect(() => {
    const el = inputRef.current;
    const measurer = measureRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = `${Math.min(el.scrollHeight, INPUT_MAX_HEIGHT)}px`;
    }
    if (el && measurer) {
      measurer.textContent = `${value}\u200b`;
      const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 22;
      const lines = Math.max(1, Math.round(measurer.scrollHeight / lineHeight));
      setMeasuredExpanded((prev) => (lines > 1) === prev ? prev : lines > 1);
    }
  }, [value, measuredExpanded, inputRef]);

  const expanded = getComposerMode(value) === 'expanded' || measuredExpanded;

  const inputControl = (
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
      {...(expanded ? footerStyles.footer.inputExpanded : {})}
      flex={expanded ? 'none' : '1'}
      width={expanded ? '100%' : undefined}
      minW="0"
      gridRow={1}
      gridColumn="1 / -1"
    />
  );

  // The hidden measurer lives in the mode-independent wrapper so its
  // width (and therefore the wrap count) is identical in both modes.
  const measurer = (
    <Box
      ref={measureRef}
      aria-hidden="true"
      position="absolute"
      top="0"
      left="0"
      visibility="hidden"
      pointerEvents="none"
      whiteSpace="pre-wrap"
      overflowWrap="anywhere"
      wordBreak="break-word"
      fontSize={{ base: '15px', lg: '16px' }}
      lineHeight="1.45"
      width="calc(100% - 185px)"
    />
  );

  // Attachment preview strip: only mounted while files are selected, so
  // the composer layout is byte-identical when there is nothing to show.
  // Wraps on narrow screens; names truncate instead of pushing controls.
  const attachmentPreview = attachments.length === 0 ? null : (
    <Box display="flex" flexWrap="wrap" gap={1.5} pb={2} maxW="100%">
      {attachments.map((att) => (
        <Box
          key={att.id}
          display="flex"
          alignItems="center"
          gap={1.5}
          px={1.5}
          py={1}
          borderRadius="md"
          borderWidth="1px"
          maxW="100%"
          minW="0"
        >
          <img
            src={att.data}
            alt={att.name}
            width={32}
            height={32}
            style={{ objectFit: 'cover', borderRadius: 6, flexShrink: 0 }}
          />
          <Box minW="0">
            <Text fontSize="xs" fontWeight="medium" truncate maxW="120px">
              {att.name}
            </Text>
            <Text fontSize="xs" color="gray.500" whiteSpace="nowrap">
              {formatFileSize(att.size)} · {att.mimeType}
            </Text>
          </Box>
          <IconButton
            aria-label={t('footer.removeAttachment')}
            variant="ghost"
            size="xs"
            flexShrink={0}
            onClick={() => onRemoveAttachment?.(att.id)}
          >
            <FiX size="14" />
          </IconButton>
        </Box>
      ))}
    </Box>
  );

  // SINGLE render tree: the SAME <textarea> DOM node stays mounted in
  // both modes, so focus/selection survive compact <-> expanded and the
  // Android keyboard never dismisses. Mode only flips CSS on one stable
  // container (flex row vs grid with a bottom control row); conditional
  // siblings are focus-free divs, never the textarea.
  // Grid tracks (expanded): attach | spacer | sound | div | mic | send.
  // In compact flex mode all grid props are ignored by the browser.
  return (
    <Box position="relative" width="100%" minW="0">
      {measurer}
      {attachmentPreview}
      <Box
        {...footerStyles.footer.composerBar}
        display={expanded ? 'grid' : 'flex'}
        gridTemplateColumns="auto 1fr auto auto auto auto"
        gridTemplateRows="auto 52px"
        pt={expanded ? miliTokens.space[3] : undefined}
      >
        <IconButton
          aria-label="Attach file"
          variant="ghost"
          {...footerStyles.footer.attachButton(attachmentCount > 0)}
          gridRow={2}
          gridColumn={1}
          onClick={() => fileInputRef.current?.click()}
        >
          <FiPlus size="21" />
        </IconButton>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(event) => {
            onFileSelect?.(event.target.files);
            event.target.value = '';
          }}
        />
        {expanded ? null : <Box {...footerStyles.footer.divider} />}
        {inputControl}
        {expanded ? null : <Box {...footerStyles.footer.divider} />}
        <IconButton
          aria-label={soundOn ? 'Mute avatar voice' : 'Enable avatar voice'}
          variant="ghost"
          {...footerStyles.footer.soundButton(soundOn)}
          gridRow={2}
          gridColumn={3}
          onClick={onSoundToggle}
        >
          {soundOn ? <FiVolume2 size="20" /> : <FiVolumeX size="20" />}
        </IconButton>
        <Box
          {...(expanded
            ? footerStyles.footer.dividerShort
            : footerStyles.footer.divider)}
          gridRow={2}
          gridColumn={4}
        />
        <IconButton
          aria-label={micOn ? 'Mute microphone' : 'Enable microphone'}
          variant="ghost"
          {...footerStyles.footer.micButton(micOn)}
          gridRow={2}
          gridColumn={5}
          onClick={onMicToggle}
        >
          {micOn ? <FiMic size="20" /> : <FiMicOff size="20" />}
        </IconButton>
        <IconButton
          aria-label="Send message"
          {...footerStyles.footer.sendButton}
          gridRow={2}
          gridColumn={6}
          onClick={onSend}
        >
          <FiArrowUp size="21" strokeWidth={2.5} />
        </IconButton>
      </Box>
    </Box>
  );
});

ComposerBar.displayName = 'ComposerBar';

// Main component.
// The composer is a single visual unit: only the bar renders. The legacy
// header (chevron toggle, status text, interrupt button) is intentionally
// not rendered; all behavior hooks stay wired so no logic is lost.
function Footer({ isCollapsed = false }: FooterProps): JSX.Element {
  const [soundOn, setSoundOn] = useState(() => !audioManager.isMuted());
  const { endAllSpeaking } = useAvatarActivityState();
  const {
    inputValue,
    handleInputChange,
    handleKeyPress,
    handleCompositionStart,
    handleCompositionEnd,
    handleMicToggle,
    micOn,
    handleSend,
    handleFileSelect,
    removeAttachment,
    attachments,
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
      {!isCollapsed && (
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
          onRemoveAttachment={removeAttachment}
          attachments={attachments}
          attachmentCount={attachmentCount}
          inputRef={inputRef}
        />
      )}
    </Box>
  );
}

export default Footer;
