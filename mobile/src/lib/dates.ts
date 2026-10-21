import { getDeviceLocale } from '@/i18n';

/** A date in the device's medium style ("21 Oct 2026", "Oct 21, 2026"), like the date picker. */
export const formatDate = (date: Date) =>
  new Intl.DateTimeFormat(getDeviceLocale(), { dateStyle: 'medium' }).format(date);
