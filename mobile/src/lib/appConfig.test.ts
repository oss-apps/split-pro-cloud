import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import appConfig from '../../app.config';

const context = {
  config: { name: 'SplitPro', slug: 'splitpro' },
  projectRoot: process.cwd(),
  staticConfigPath: null,
  packageJsonPath: 'package.json',
};

describe('Android push build configuration', () => {
  it('should use the Firebase file supplied by EAS and allow local builds without it', () => {
    const previous = process.env.GOOGLE_SERVICES_JSON;

    try {
      delete process.env.GOOGLE_SERVICES_JSON;
      assert.equal(appConfig(context).android?.googleServicesFile, undefined);

      process.env.GOOGLE_SERVICES_JSON = '/eas/secret/google-services.json';
      assert.equal(
        appConfig(context).android?.googleServicesFile,
        '/eas/secret/google-services.json',
      );
    } finally {
      if (undefined === previous) {
        delete process.env.GOOGLE_SERVICES_JSON;
      } else {
        process.env.GOOGLE_SERVICES_JSON = previous;
      }
    }
  });

  it('should configure the default channel and a 96x96 PNG notification icon', () => {
    const config = appConfig(context);
    assert.deepEqual(
      config.plugins?.find((plugin) => Array.isArray(plugin) && 'expo-notifications' === plugin[0]),
      [
        'expo-notifications',
        { icon: './assets/notification-icon.png', color: '#06b6d4', defaultChannel: 'default' },
      ],
    );
    const icon = readFileSync('assets/notification-icon.png');
    assert.equal(icon.subarray(1, 4).toString(), 'PNG');
    assert.equal(icon.readUInt32BE(16), 96);
    assert.equal(icon.readUInt32BE(20), 96);
  });
});
