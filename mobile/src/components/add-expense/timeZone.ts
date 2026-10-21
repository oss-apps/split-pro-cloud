import { getCalendars } from 'expo-localization';

/** The device's time zone, which a new rule's dates start in. Like the web's `getDeviceTimeZone`. */
export const getDeviceTimeZone = () =>
  getCalendars()[0]?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
