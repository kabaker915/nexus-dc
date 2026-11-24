/**
 * Parser regression test for real-device identification.
 * Run: node tools/parse-test.mjs
 */
import { parseProbe, detectVendor } from '../src/realnet.js';

const cases = [
  {
    name: 'H3C comware',
    family: 'comware',
    raw: {
      version: 'H3C Comware Software, Version 7.1.070, Release 3506P02\nCopyright (c) 2004-2024 New H3C\nH3C S5130S-28P-EI uptime is 12 weeks, 3 days',
      cpu: 'Slot 1 CPU usage:\n        17% in last 5 seconds\n        20% in last 1 minute',
      mem: 'System Total Memory: 2048 MB\nTotal Used Memory: 812 MB\nUsed Rate: 39%',
      env: 'Slot Sensor Status Temperature(C) Lower Warning Alarm\n1 Inlet Normal 23.5 -5 45 60\n1 CPU Normal 41.2 0 60 75',
      intf: 'Interface Link Speed\nGE1/0/1 UP 1G\nGE1/0/2 DOWN auto\nGE1/0/3 UP 10G',
    },
    expect: { vendor: 'h3c', model: 'S5130S-28P-EI', cpu: 17, mem: 39, temp: 41.2, portsUp: 2 },
  },
  {
    name: 'Huawei VRP',
    family: 'comware',
    raw: {
      version: 'Huawei Versatile Routing Platform Software\nVRP (R) software, Version 8.180\nHUAWEI S5735-L24T4X uptime is 3 weeks',
      cpu: '17% in last 5 seconds',
      mem: 'Used Rate: 44%',
      env: '1 Inlet Normal 22.0 -5 45 60',
      intf: 'GE0/0/1 UP 1G\nGE0/0/2 UP 1G\nGE0/0/3 DOWN auto',
    },
    expect: { vendor: 'huawei', model: 'S5735-L24T4X', cpu: 17, mem: 44, temp: 22, portsUp: 2 },
  },
  {
    name: 'Cisco IOS',
    family: 'ios',
    raw: {
      version: 'Cisco IOS XE Software, Version 17.09.04a\ncisco C9300-48P (X86) processor with 8388608K bytes of memory.',
      cpu: 'CPU utilization for five seconds: 12%/2%; one minute: 15%; five minutes: 14%',
      mem: '                Head    Total(b)     Used(b)\nProcessor    7f8c4a0  1000000  400000',
      env: 'Inlet Temperature: 24 C',
      intf: 'Interface IP-Address OK? Method Status Protocol\nGigabitEthernet1/0/1 10.0.0.1 YES manual up up\nGigabitEthernet1/0/2 unassigned YES unset down down',
    },
    expect: { vendor: 'cisco', model: 'C9300-48P', cpu: 12, mem: 40, temp: 24, portsUp: 1 },
  },
  {
    name: 'Linux host',
    family: 'linux',
    raw: {
      version: 'Linux srv01 5.15.0-105-generic #115-Ubuntu SMP x86_64 GNU/Linux',
      cpu: '%Cpu(s): 12.0 us,  3.0 sy,  0.0 ni, 85.0 id',
      mem: '              total        used        free\nMem:          16000        4800        9000',
      env: 'Package id 0:  +48.0°C  (high = +85.0°C)',
      intf: 'eth0  UP  10.0.0.5/24\neth1  DOWN',
    },
    expect: { vendor: 'linux', model: 'srv01', cpu: 15, mem: 30, temp: 48, portsUp: 1 },
  },
];

let failed = 0;
for (const c of cases) {
  const got = parseProbe(c.raw, c.family);
  const bad = [];
  for (const [k, v] of Object.entries(c.expect)) {
    const g = got[k];
    const ok = typeof v === 'number' ? Math.abs(Number(g) - v) < 0.11 : g === v;
    if (!ok) bad.push(`${k}: got ${JSON.stringify(g)} expected ${JSON.stringify(v)}`);
  }
  if (detectVendor(c.raw.version) !== c.expect.vendor) bad.push(`detectVendor ${detectVendor(c.raw.version)}`);
  if (bad.length) {
    failed++;
    console.log(`FAIL ${c.name}\n  ${bad.join('\n  ')}`);
  } else {
    console.log(`PASS ${c.name} → ${got.vendor} ${got.model} cpu=${got.cpu} mem=${got.mem} temp=${got.temp} up=${got.portsUp}`);
  }
}
console.log(failed ? `\n${failed} case(s) failed` : '\nall parser cases passed');
process.exit(failed ? 1 : 0);
