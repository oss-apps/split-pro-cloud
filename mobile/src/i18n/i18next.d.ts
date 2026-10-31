import type en from './locales/en.json';

// Makes `t('auth.send_code')` type-checked against the English keys.
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    resources: { translation: typeof en };
  }
}
