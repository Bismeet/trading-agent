// scripts/start_all.mjs
// Cross-platform runner to start all FabRich services:
// 1. Tauric AI Decision Service (Python FastAPI, port 8000)
// 2. FabRich Trading Engine (Node.js 30s cycle)
// 3. FabRich Web Dashboard (Next.js, port 3000)

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const dataDir = path.join(rootDir, 'data');
const servicesFile = path.join(dataDir, 'services.json');

console.log('\x1b[36m%s\x1b[0m', '=======================================================');
console.log('\x1b[36m%s\x1b[0m', ' Starting FabRich Apex Trading Bot + Embedded Tauric AI ');
console.log('\x1b[36m%s\x1b[0m', '=======================================================');

// Resolve local python
const isWin = process.platform === 'win32';
const venvPy = isWin 
  ? path.join(rootDir, '.venv', 'Scripts', 'python.exe')
  : path.join(rootDir, '.venv', 'bin', 'python');
const pythonCmd = fs.existsSync(venvPy) ? venvPy : (isWin ? 'python' : 'python3');

const logDir = path.join(rootDir, 'logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

const aiOut = fs.openSync(path.join(logDir, 'ai.log'), 'a');
const aiErr = fs.openSync(path.join(logDir, 'ai_err.log'), 'a');
const engineOut = fs.openSync(path.join(logDir, 'engine.log'), 'a');
const engineErr = fs.openSync(path.join(logDir, 'engine_err.log'), 'a');
const webOut = fs.openSync(path.join(logDir, 'web.log'), 'a');
const webErr = fs.openSync(path.join(logDir, 'web_err.log'), 'a');

console.log('\x1b[32m%s\x1b[0m', `[1/3] Starting Tauric AI Decision Service using ${pythonCmd}...`);
const aiProc = spawn(pythonCmd, ['ai/tauric/server.py'], {
  cwd: rootDir,
  detached: true,
  stdio: ['ignore', aiOut, aiErr]
});
aiProc.unref();

console.log('\x1b[32m%s\x1b[0m', '[2/3] Starting FabRich Trading Engine...');
const engineProc = spawn(process.execPath, ['scripts/v2/engine.mjs'], {
  cwd: rootDir,
  detached: true,
  stdio: ['ignore', engineOut, engineErr]
});
engineProc.unref();

console.log('\x1b[32m%s\x1b[0m', '[3/3] Starting FabRich Next.js Web Dashboard on http://localhost:3000...');
const npmCmd = isWin ? 'npm.cmd' : 'npm';
const webProc = spawn(npmCmd, ['run', 'dev'], {
  cwd: path.join(rootDir, 'web'),
  detached: true,
  stdio: ['ignore', webOut, webErr],
  shell: isWin
});
webProc.unref();

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const pids = {
  aiPid: aiProc.pid,
  enginePid: engineProc.pid,
  webPid: webProc.pid,
  startedAt: new Date().toISOString()
};

fs.writeFileSync(servicesFile, JSON.stringify(pids, null, 2), 'utf-8');

console.log('');
console.log('\x1b[32m%s\x1b[0m', 'All FabRich services launched successfully!');
console.log('\x1b[33m%s\x1b[0m', '  - AI Service:   http://127.0.0.1:8000 (Docs: http://127.0.0.1:8000/docs)');
console.log('\x1b[33m%s\x1b[0m', '  - Web UI:       http://localhost:3000');
console.log('\x1b[33m%s\x1b[0m', `  - Engine PID:   ${engineProc.pid}`);
console.log('\x1b[36m%s\x1b[0m', 'To stop all services: npm run stop:all or powershell -File scripts/stop-all.ps1');
