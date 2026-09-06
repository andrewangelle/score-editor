import { mergeConfig } from 'vite';
import baseConfig from './vite.config.ts';
import { suppressLogging, createE2ELogger, suppressKnownConsoleNoise } from './tests/e2e/plugins/suppressLogging.ts';

suppressKnownConsoleNoise();

export default mergeConfig(baseConfig, {
  define: {
    'import.meta.env.VITE_E2E': JSON.stringify('true'),
  },
  customLogger: createE2ELogger(),
  logLevel: 'error',
  server: {
    port: 3100,
    strictPort: true,
  },
  plugins: [
    suppressLogging(),
  ],
  resolve: {
    dedupe: ['react', 'react-dom'],
    tsconfigPaths: true,
  },
});
