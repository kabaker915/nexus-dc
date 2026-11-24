/* CDP-driven screenshot harness (dev only).
 * Usage: node tools/cdp.mjs <url> <out.png> [waitMs] [preShotJS] [secondOut.png]
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9333;

const url = process.argv[2] || 'http://127.0.0.1:5199/';
const out = process.argv[3] || path.join(HERE, 'shot.png');
const waitMs = Number(process.argv[4] || 6000);
const preJS = process.argv[5] || '';
const out2 = process.argv[6] || '';

const profile = path.join(HERE, '.edge-profile');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const proc = spawn(EDGE, [
  '--headless=new',
  '--no-sandbox',
  '--disable-crash-reporter',
  '--disable-breakpad',
  '--disable-features=Translate,MediaRouter',
  '--enable-unsafe-swiftshader',
  '--hide-scrollbars',
  '--force-device-scale-factor=1',
  '--window-size=1680,960',
  `--user-data-dir=${profile}`,
  `--remote-debugging-port=${PORT}`,
  'about:blank',
], { stdio: 'ignore' });

async function targets() {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
    return await r.json();
  } catch {
    return null;
  }
}

let list = null;
for (let i = 0; i < 60; i++) {
  list = await targets();
  if (list && list.some((t) => t.type === 'page')) break;
  await sleep(250);
}
if (!list) { console.error('edge did not start'); process.exit(1); }
const page = list.find((t) => t.type === 'page');

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.addEventListener('open', res, { once: true });
  ws.addEventListener('error', rej, { once: true });
});

let seq = 0;
const pending = new Map();
const logs = [];
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
    return;
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    const d = msg.params.exceptionDetails;
    logs.push(`EXCEPTION ${d.exception?.description || d.text}`);
  }
  if (msg.method === 'Runtime.consoleAPICalled') {
    const text = msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ');
    logs.push(`console.${msg.params.type}: ${text}`);
  }
  if (msg.method === 'Log.entryAdded') {
    logs.push(`log.${msg.params.entry.level}: ${msg.params.entry.text}`);
  }
});

const send = (method, params = {}) => new Promise((res) => {
  const id = ++seq;
  pending.set(id, (m) => res(m.result ?? m.error));
  ws.send(JSON.stringify({ id, method, params }));
});

await send('Runtime.enable');
await send('Log.enable');
await send('Page.enable');
await send('Page.navigate', { url });
await sleep(waitMs);

const shot = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));

const info = await send('Runtime.evaluate', {
  expression: `JSON.stringify({
    title: document.title,
    loading: document.getElementById('loading')?.className || '',
    fatal: document.getElementById('fatal')?.hidden === false ? document.getElementById('fatal-msg').textContent.slice(0,600) : '',
    canvases: [...document.querySelectorAll('canvas')].map(c => c.width + 'x' + c.height),
    racks: window.__app ? window.__app.state.racks.length : -1,
    devices: window.__app ? Object.keys(window.__app.state.devices).length : -1
  })`,
  returnByValue: true,
});
logs.push(`state: ${info.result?.value}`);

if (preJS) {
  const src = preJS.startsWith('@')
    ? fs.readFileSync(path.join(HERE, preJS.slice(1)), 'utf8')
    : preJS;
  const r = await send('Runtime.evaluate', { expression: src, returnByValue: true, awaitPromise: true });
  logs.push(`preJS: ${JSON.stringify(r.result?.value)} ${r.exceptionDetails?.text || ''}`);
  await sleep(2500);
  const s2 = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(out2 || out.replace(/\.png$/, '_2.png'), Buffer.from(s2.data, 'base64'));
}

fs.writeFileSync(`${out}.log`, logs.join('\n'));
console.log(logs.join('\n'));
ws.close();
proc.kill();
process.exit(0);
