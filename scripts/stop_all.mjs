// scripts/stop_all.mjs
// Cross-platform runner to stop all FabRich services:
// 1. Tauric AI Decision Service (Python FastAPI, port 8000)
// 2. FabRich Trading Engine (Node.js)
// 3. FabRich Web Dashboard (Next.js, port 3000)

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const servicesFile = path.join(rootDir, 'data', 'services.json');

console.log('\x1b[36m%s\x1b[0m', '=======================================================');
console.log('\x1b[36m%s\x1b[0m', ' Stopping FabRich Apex Trading Bot + Embedded Tauric AI ');
console.log('\x1b[36m%s\x1b[0m', '=======================================================');

function killPid(pid, label) {
  if (!pid) return;
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' });
    } else {
      process.kill(pid, 'SIGTERM');
    }
    console.log(`Stopped ${label} (PID: ${pid})`);
  } catch {
    // Process may have already exited
  }
}

if (fs.existsSync(servicesFile)) {
  try {
    const pids = JSON.parse(fs.readFileSync(servicesFile, 'utf-8'));
    killPid(pids.aiPid, 'Tauric AI Service');
    killPid(pids.enginePid, 'FabRich Engine');
    killPid(pids.webPid, 'Web Dashboard');
    fs.unlinkSync(servicesFile);
  } catch (err) {
    console.warn('Error cleaning up services file:', err.message);
  }
}

// Ensure ports 8000 and 3000 are freed on Windows
if (process.platform === 'win32') {
  try {
    const script = `
      @(8000, 3000) | ForEach-Object {
        $port = $_
        Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | ForEach-Object {
          if ($_.OwningProcess -gt 0) {
            Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue
          }
        }
      }
    `;
    execSync(`powershell -Command "${script.replace(/\r?\n/g, ' ')}"`, { stdio: 'ignore' });
  } catch {}
}

console.log('');
console.log('\x1b[32m%s\x1b[0m', 'All FabRich services stopped cleanly.');
