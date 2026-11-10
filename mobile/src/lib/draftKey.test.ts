import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { keyForDraft } from './draftKey';

describe('keyForDraft', () => {
  it('should keep the key for retries and change it when the text is edited', () => {
    let count = 0;
    const newKey = () => `key-${++count}`;

    const first = keyForDraft(null, 'Some feedback', newKey);
    assert.equal(keyForDraft(first, 'Some feedback', newKey).key, first.key);
    assert.notEqual(keyForDraft(first, 'Some feedback, edited', newKey).key, first.key);
  });
});
