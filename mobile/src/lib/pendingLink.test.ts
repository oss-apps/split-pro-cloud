import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { getLinkPath, hasPendingLink, savePendingLink, takePendingLink } from './pendingLink';

describe('getLinkPath', () => {
  describe('App links', () => {
    it('should read the path from the custom scheme', () => {
      assert.equal(getLinkPath('splitpro://join-group?groupId=abc'), '/join-group?groupId=abc');
      assert.equal(getLinkPath('splitpro://groups/5'), '/groups/5');
      assert.equal(getLinkPath('splitpro:///expenses/x1'), '/expenses/x1');
    });

    it('should read the path from web URLs', () => {
      assert.equal(
        getLinkPath('https://splitpro.app/join-group?groupId=abc#top'),
        '/join-group?groupId=abc',
      );
      assert.equal(getLinkPath('http://localhost:8106/balances/3/'), '/balances/3');
    });

    it('should read the path from Expo Go links', () => {
      assert.equal(getLinkPath('exp://192.168.1.2:8081/--/groups/5'), '/groups/5');
    });
  });

  describe('Nothing to come back to', () => {
    it('should ignore the start and sign-in screens', () => {
      assert.equal(getLinkPath('splitpro://'), null);
      assert.equal(getLinkPath('https://splitpro.app/'), null);
      assert.equal(getLinkPath('exp://192.168.1.2:8081'), null);
      assert.equal(getLinkPath('splitpro://oauth-callback?code=1'), null);
      assert.equal(getLinkPath('http://localhost:8106/sign-in'), null);
    });

    it('should ignore dev client and invalid links', () => {
      assert.equal(
        getLinkPath('exp+splitpro://expo-development-client/?url=http%3A%2F%2F10.0.0.1%3A8081'),
        null,
      );
      assert.equal(getLinkPath('not a url'), null);
      assert.equal(getLinkPath(null), null);
    });
  });
});

describe('takePendingLink', () => {
  it('should return the last saved link once', () => {
    assert.equal(hasPendingLink(), false);
    savePendingLink('splitpro://groups/1');
    savePendingLink('splitpro://sign-in');
    assert.equal(hasPendingLink(), true);
    assert.equal(takePendingLink(), '/groups/1');
    assert.equal(hasPendingLink(), false);
    assert.equal(takePendingLink(), null);
  });
});
