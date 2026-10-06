import { build } from 'vite';

try {
  await build({
    logLevel: 'error',
    configFile: 'vite.config.js',
    clearScreen: false,
  });
  console.log('SUCCESS');
} catch (error) {
  console.error('ERROR-STACK');
  console.error(error && error.stack ? error.stack : String(error));
  process.exitCode = 1;
}
