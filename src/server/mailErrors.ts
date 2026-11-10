/**
 * Pure helpers for SMTP send errors. Kept free of db and env imports so they can be unit tested.
 */

/** Our own code for "SMTP isn't configured", which never reaches a server. */
export const MAIL_NOT_CONFIGURED = 'ENOTCONFIGURED';

/** Failures that happen before the server could have accepted the message. */
const DEFINITE_CODES = new Set([
  MAIL_NOT_CONFIGURED,
  'EAUTH',
  'ENOAUTH',
  'EOAUTH2',
  'EENVELOPE',
  'EMESSAGE',
  'EDNS',
  'ETLS',
  'EREQUIRETLS',
  'ECONFIG',
]);
/** Timeouts while still connecting, before anything was sent. */
const SETUP_TIMEOUTS = new Set(['CONNECT_TIMEOUT', 'GREETING_TIMEOUT', 'UPGRADE_TIMEOUT']);
/** Socket errors that only happen while opening the connection. */
const CONNECT_ERRORS = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EAI_AGAIN',
]);

type SmtpError = {
  code?: unknown;
  originalCode?: unknown;
  responseCode?: unknown;
  timeoutType?: unknown;
};

const asSmtpError = (error: unknown): SmtpError =>
  error && 'object' === typeof error ? (error as SmtpError) : {};

const ERROR_CODE = /^E[A-Z0-9_]{1,30}$/;

/**
 * The parts of a send error that are safe to log or keep: nodemailer's error code and the SMTP
 * reply code. Never the message, which can contain addresses or the server's reply text.
 */
export const safeMailErrorDetails = (error: unknown) => {
  const { code, responseCode } = asSmtpError(error);
  return {
    code: 'string' === typeof code && ERROR_CODE.test(code) ? code : undefined,
    responseCode:
      'number' === typeof responseCode && Number.isInteger(responseCode) ? responseCode : undefined,
  };
};

/**
 * Whether a send error means the message certainly wasn't accepted, so sending it again can't
 * deliver it twice. Dropped connections and timeouts once connected are uncertain: the server may
 * have accepted the message before the connection went.
 */
export const isDefiniteSendFailure = (error: unknown) => {
  const { code, originalCode, responseCode, timeoutType } = asSmtpError(error);

  // The server answered, and refused
  if ('number' === typeof responseCode && 400 <= responseCode) {
    return true;
  }
  if ('string' !== typeof code) {
    return false;
  }
  if (DEFINITE_CODES.has(code)) {
    return true;
  }
  if ('ETIMEDOUT' === code) {
    return 'string' === typeof timeoutType && SETUP_TIMEOUTS.has(timeoutType);
  }
  if ('ESOCKET' === code) {
    return 'string' === typeof originalCode && CONNECT_ERRORS.has(originalCode);
  }
  return false;
};
