import {
  Stack,
  Text,
  Heading,
  HStack,
  Icon,
} from '@chakra-ui/react';
import { useTranslation } from 'react-i18next';
import { FaGithub, FaBook } from 'react-icons/fa';
import { settingStyles } from './setting-styles';
import { Button } from '@/components/ui/button';
import { SettingSection } from './common';

function About(): JSX.Element {
  const { t } = useTranslation();
  
  const openExternalLink = (url: string) => {
    // Handle external link opening via electron
    window.open(url, '_blank');
  };
  
  const appVersion = '1.2.1';
  // const appAuthor = 'Open LLM VTuber Team';

  return (
    <Stack {...settingStyles.common.container} gap={3}>
      <Heading size="md" mb={1}>
        {t("settings.about.title")}
      </Heading>
      <SettingSection title={t("settings.about.version")}>
        <Text>{appVersion}</Text>
      </SettingSection>
      {/* <Box mt={1}>
        <Text fontWeight="bold" mb={0}>{t('Author')}</Text>
        <Text>{appAuthor}</Text>
      </Box> */}
      <SettingSection title={t("settings.about.projectLinks")}>
        <HStack mt={1} gap={2}>
          <Button
            size="sm"
            onClick={() =>
              openExternalLink(
                "https://github.com/Open-LLM-VTuber/Open-LLM-VTuber-Web"
              )
            }
          >
            <Icon as={FaGithub} mr={2} /> {t("settings.about.github")}
          </Button>
          <Button
            size="sm"
            onClick={() => openExternalLink("https://docs.llmvtuber.com")}
          >
            <Icon as={FaBook} mr={2} /> {t("settings.about.documentation")}
          </Button>
        </HStack>
      </SettingSection>
      <SettingSection title={t("settings.about.copyright")}>
        <Button size="xs" colorPalette="blue" onClick={() => openExternalLink("https://github.com/Open-LLM-VTuber/Open-LLM-VTuber-Web/blob/main/LICENSE")}>
          {t("settings.about.viewLicense")}
        </Button>
        <Text>© {new Date().getFullYear()} Open LLM VTuber Team</Text>
      </SettingSection>
    </Stack>
  );
}

export default About;
