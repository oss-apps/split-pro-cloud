import React, { useState } from 'react';
import { Check, ChevronRight, Languages } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { AppDrawer } from '../ui/drawer';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem } from '../ui/command';
import { cn } from '~/lib/utils';
import { SUPPORTED_LANGUAGES, changeLanguage } from '~/utils/i18n';

export const LanguagePicker: React.FC = () => {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);

  const currentLanguage = SUPPORTED_LANGUAGES.find((l) => l.code === i18n.language);

  async function onSelect(code: string) {
    setOpen(false);
    try {
      await changeLanguage(code);
    } catch (error) {
      console.error(error);
      toast.error(t('errors.language_change_failed'));
    }
  }

  return (
    <AppDrawer
      trigger={
        <div className="flex w-full justify-between px-0 py-2 text-[16px] font-medium text-gray-300 hover:text-foreground/80">
          <div className="flex items-center gap-4">
            <Languages className="h-5 w-5 text-sky-500" />
            {t('account.change_language')}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500">{currentLanguage?.name}</span>
            <ChevronRight className="h-6 w-6 text-gray-500" />
          </div>
        </div>
      }
      onTriggerClick={() => setOpen(true)}
      open={open}
      onOpenChange={(openVal) => {
        if (openVal !== open) setOpen(openVal);
      }}
      leftAction={t('actions.close')}
      title={t('account.change_language_details.title')}
      className="h-[70vh]"
      shouldCloseOnAction
    >
      <Command className="h-[50vh]">
        <CommandInput
          className="text-lg"
          placeholder={t('account.change_language_details.placeholder')}
        />
        <CommandEmpty>{t('account.change_language_details.no_language_found')}</CommandEmpty>
        <CommandGroup className="h-full overflow-auto">
          {SUPPORTED_LANGUAGES.map((language) => (
            <CommandItem
              key={language.code}
              value={`${language.code} ${language.name}`}
              onSelect={() => void onSelect(language.code)}
            >
              <Check
                className={cn(
                  'mr-2 h-4 w-4',
                  language.code === i18n.language ? 'opacity-100' : 'opacity-0',
                )}
              />
              {language.name}
            </CommandItem>
          ))}
        </CommandGroup>
      </Command>
    </AppDrawer>
  );
};
