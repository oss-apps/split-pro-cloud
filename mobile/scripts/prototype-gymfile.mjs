import { constants, copyFileSync } from 'node:fs';

// EAS runs this supported hook after prebuild/pod install and before choosing its Gymfile.
// Normal releases and Android builds retain EAS's default export behavior.
if (
  'ios' === process.env.EAS_BUILD_PLATFORM &&
  'prototype' === process.env.EAS_BUILD_PROFILE &&
  '1' === process.env.EXPO_PUBLIC_PROTOTYPE_READONLY
) {
  copyFileSync(
    new URL('./Gymfile.prototype', import.meta.url),
    'ios/Gymfile',
    constants.COPYFILE_EXCL,
  );
  console.info('Prototype export: TestFlight internal testing only; build number preserved.');
}
