/**
 * The idempotency key a feedback draft is sent with.
 */
export type DraftKey = { text: string; key: string };

/**
 * The key to send `text` with: the previous one while the text is unchanged, so retries of the
 * same draft are saved once, and a new one once it's edited, so the server never mistakes the
 * edited text for the earlier attempt.
 */
export const keyForDraft = (previous: DraftKey | null, text: string, newKey: () => string) =>
  previous && previous.text === text ? previous : { text, key: newKey() };
