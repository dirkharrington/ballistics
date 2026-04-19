module.exports = {
  server: {
    command: './node_modules/.bin/vite --port 5173',
    port: 5173,
    host: 'localhost',
    usedPortAction: 'kill',
    launchTimeout: 30000,
    debug: false,
  },
  launch: {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  },
};
