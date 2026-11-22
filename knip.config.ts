import type { KnipConfig } from 'knip';

const config: KnipConfig = {
  entry: [
    'app/index.html',
    'app/sw.js',
    'app/physics/engine.worker.ts',
  ],
  project: [
    'app/**/*.{js,ts}',
    '!app/data/**',
    '!app/fonts/**',
    '!app/public/**',
  ],
  jest: {
    config: ['package.json'],
    entry: [
      'tests/**/*.test.{js,ts}',
      'tests/__mocks__/**/*.js',
      'tests/fixtures/**/*.{js,json}',
    ],
  },
  vite: {
    config: ['vite.config.mjs'],
  },
};

export default config;
