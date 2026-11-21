const fs = require('fs');

const CHROME_CANDIDATES = [
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

const envExecutable = process.env.PUPPETEER_EXECUTABLE_PATH;
const executablePath = (envExecutable && fs.existsSync(envExecutable))
  ? envExecutable
  : CHROME_CANDIDATES.find(candidate => fs.existsSync(candidate));

module.exports = {
  server: {
    command: './node_modules/.bin/vite preview --port 4173 --strictPort --host 127.0.0.1',
    port: 4173,
    host: '127.0.0.1',
    usedPortAction: 'kill',
    launchTimeout: 30000,
    debug: false,
  },
  launch: {
    headless: true,
    ...(executablePath ? { executablePath } : {}),
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  },
};
