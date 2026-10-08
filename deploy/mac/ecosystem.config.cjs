// pm2 process file for the Mac install. Start it from the live copy:
//   pm2 start ~/ezbiz/deploy/mac/ecosystem.config.cjs && pm2 save
// Settings come from apps/portal/.env (read by the server itself).
const path = require('path')

module.exports = {
  apps: [{
    name: 'ezbiz',
    cwd: path.resolve(__dirname, '../../apps/portal'),
    script: 'dist/server/index.js',
    interpreter: '/opt/homebrew/opt/node@22/bin/node',
    max_memory_restart: '512M',
    // The server finishes requests in flight before it exits.
    kill_timeout: 30000,
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
  }],
}
