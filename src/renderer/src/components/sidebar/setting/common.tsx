/* eslint-disable react/require-default-props */
import { useState } from 'react';
import {
  Text, Input, NumberInput, createListCollection, Flex, Box, Stack,
} from '@chakra-ui/react';
import { HiQuestionMarkCircle } from 'react-icons/hi';
import { Field } from '@/components/ui/field';
import { Switch } from '@/components/ui/switch';
import { Tooltip } from '@/components/ui/tooltip';
import { miliTokens } from '@/theme/design-tokens';
import {
  SelectContent,
  SelectItem,
  SelectRoot,
  SelectTrigger,
  SelectValueText,
} from '@/components/ui/select';
import { settingStyles } from './setting-styles';

// Help Icon Component
interface HelpIconProps {
  content: string;
}

function HelpIcon({ content }: HelpIconProps): JSX.Element {
  const [isHovering, setIsHovering] = useState(false);

  const handleMouseEnter = () => setIsHovering(true);
  const handleMouseLeave = () => setIsHovering(false);

  return (
    <Tooltip
      showArrow
      content={
        <Text fontSize="sm" maxW="300px" lineHeight="1.4">
          {content}
        </Text>
      }
      open={isHovering}
    >
      <Box
        as={HiQuestionMarkCircle}
        color={miliTokens.color.textMuted}
        _hover={{ color: miliTokens.color.textSecondary }}
        cursor="help"
        w="16px"
        h="16px"
        ml="2"
        transition="color 0.2s"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      />
    </Tooltip>
  );
}

// Common Props Types
interface SelectFieldProps {
  label: string
  value: string[]
  onChange: (value: string[]) => void
  collection: ReturnType<typeof createListCollection<{ label: string; value: string }>>
  placeholder: string
}

interface NumberFieldProps {
  label: string
  value: number | string
  onChange: (value: string) => void
  min?: number
  max?: number
  step?: number
  allowMouseWheel?: boolean
  help?: string
}

interface SwitchFieldProps {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
  help?: string
}

interface InputFieldProps {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  help?: string
}

// Reusable Components
// One form language: every field (select/number/switch/input) renders on
// the shared `common` surface styles, so tabs never drift into separate
// visual dialects.
export function SelectField({
  label,
  value,
  onChange,
  collection,
  placeholder,
}: SelectFieldProps): JSX.Element {
  return (
    <Field
      {...settingStyles.common.field}
      label={<Text {...settingStyles.common.fieldLabel}>{label}</Text>}
    >
      <SelectRoot
        {...settingStyles.general.select.root}
        collection={collection}
        value={value}
        onValueChange={(e) => onChange(e.value)}
      >
        <SelectTrigger {...settingStyles.common.input}>
          <SelectValueText placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {collection.items.map((item) => (
            <SelectItem key={item.value} item={item}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </SelectRoot>
    </Field>
  );
}

export function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step,
  allowMouseWheel,
  help,
}: NumberFieldProps): JSX.Element {
  return (
    <Field
      {...settingStyles.common.field}
      label={
        <Flex align="center">
          <Text {...settingStyles.common.fieldLabel}>{label}</Text>
          {help && <HelpIcon content={help} />}
        </Flex>
      }
    >
      <NumberInput.Root
        {...settingStyles.common.numberInput.root}
        value={value.toString()}
        onValueChange={(details) => onChange(details.value)}
        min={min}
        max={max}
        step={step}
        allowMouseWheel={allowMouseWheel}
      >
        <NumberInput.Input {...settingStyles.common.numberInput.input} />
        <NumberInput.Control>
          <NumberInput.IncrementTrigger />
          <NumberInput.DecrementTrigger />
        </NumberInput.Control>
      </NumberInput.Root>
    </Field>
  );
}

export function SwitchField({ label, checked, onChange, help }: SwitchFieldProps): JSX.Element {
  return (
    <Flex width="100%" align="center" justify="space-between" gap="4">
      <Flex align="center" minW="0" flex="1">
        <Text {...settingStyles.common.fieldLabel}>{label}</Text>
        {help && <HelpIcon content={help} />}
      </Flex>
      <Switch
        {...settingStyles.common.switch}
        flexShrink="0"
        checked={checked}
        onCheckedChange={(details) => onChange(details.checked)}
      />
    </Flex>
  );
}

export function InputField({
  label,
  value,
  onChange,
  placeholder,
  help,
}: InputFieldProps): JSX.Element {
  return (
    <Field
      {...settingStyles.common.field}
      label={
        <Flex align="center">
          <Text {...settingStyles.common.fieldLabel}>{label}</Text>
          {help && <HelpIcon content={help} />}
        </Flex>
      }
    >
      <Input
        {...settingStyles.common.input}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}

// Settings section: quiet uppercase title + rows. Grouping comes from
// spacing and the title — never from cards or extra borders.
interface SettingSectionProps {
  title: string
  children: React.ReactNode
}

export function SettingSection({ title, children }: SettingSectionProps): JSX.Element {
  return (
    <Stack {...settingStyles.section.container}>
      <Text {...settingStyles.section.title}>{title}</Text>
      {children}
    </Stack>
  );
}
