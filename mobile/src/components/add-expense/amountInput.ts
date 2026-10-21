/**
 * The amount field keeps what was typed as text and the form gets `Number(text)`, like the web's
 * `onUpdateAmount`. A leading minus makes a refund, which the web allows too.
 */

/**
 * Cleans typed text: digits, one decimal point (a comma becomes a point), at most 2 decimals and an
 * optional leading minus. Anything else is dropped.
 */
export const sanitizeAmountInput = (text: string) => {
  const isNegative = text.trim().startsWith('-');
  const unsigned = text.replace(/,/g, '.').replace(/[^\d.]/g, '');
  const [whole = '', ...rest] = unsigned.split('.');
  const cleaned = rest.length ? `${whole}.${rest.join('').slice(0, 2)}` : whole;

  return `${isNegative ? '-' : ''}${cleaned}`;
};

/** The amount in major units, 0 while the text isn't a number yet (e.g. `-` or `.`). */
export const parseAmountInput = (text: string) => Number(text) || 0;

/** Flips a refund to an expense and back. The decimal pad on iOS has no minus key. */
export const toggleAmountSign = (text: string) =>
  text.startsWith('-') ? text.slice(1) : `-${text}`;
