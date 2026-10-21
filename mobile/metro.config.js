// Learn more https://docs.expo.dev/guides/customizing-metro
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const repoRoot = path.resolve(projectRoot, '..');
const sharedRoot = path.join(repoRoot, 'src');
const prismaShim = path.join(projectRoot, 'src/shims/prisma-client.ts');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(projectRoot);

// The app reuses pure logic from the web app (../src/utils, ../src/lib). Only watch that folder:
// the rest of the repo (the web's node_modules, .next, prisma) must never end up in the bundle.
config.watchFolders = [sharedRoot];

// Fail loudly instead of silently bundling a package from the web's node_modules.
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const defaultBlockList = config.resolver.blockList ?? [];
config.resolver.blockList = [
  ...(Array.isArray(defaultBlockList) ? defaultBlockList : [defaultBlockList]),
  new RegExp(`^${escapeRegExp(path.join(repoRoot, 'node_modules'))}/.*`),
];

const isBareSpecifier = (moduleName) =>
  !moduleName.startsWith('.') && !moduleName.startsWith('/') && !moduleName.startsWith('~/');

config.resolver.resolveRequest = (context, moduleName, platform) => {
  // The shared files import enums from @prisma/client. The real package is Node-only, so swap in a
  // tiny shim with the same enum values.
  if ('@prisma/client' === moduleName) {
    return { type: 'sourceFile', filePath: prismaShim };
  }

  // Packages imported by shared files (zod, date-fns, ...) resolve from mobile/node_modules as if
  // they were imported by the app, so the bundle never picks up the web's copies in ../node_modules.
  if (context.originModulePath.startsWith(sharedRoot + path.sep) && isBareSpecifier(moduleName)) {
    return context.resolveRequest(
      { ...context, originModulePath: path.join(projectRoot, 'package.json') },
      moduleName,
      platform,
    );
  }

  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
