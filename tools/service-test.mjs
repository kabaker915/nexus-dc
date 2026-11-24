/**
 * Local integration tests for the SNMP / Redfish gateway + LLDP parsing.
 * Run: node tools/service-test.mjs
 * Requires the web server on 127.0.0.1:5199 (started separately).
 */
import dgram from 'node:dgram';
import http from 'node:http';
import { parseLldp } from '../src/realnet.js';

const API = 'http://127.0.0.1:5199';

/* ---------------- minimal BER (test-side encoder) ---------------- */
const lenBytes = (n) => (n < 0x80 ? [n] : (() => {
  const b = [];
  let v = n;
  while (v > 0) { b.unshift(v & 0xff); v >>= 8; }
  return [0x80 | b.length, ...b];
})());
const tlv = (tag, content) => Buffer.from([tag, ...lenBytes(content.length), ...content]);
const encInt = (n) => {
  const b = [];
  let v = n;
  if (v === 0) b.push(0);
  while (v > 0) { b.unshift(v & 0xff); v >>= 8; }
  if (b[0] & 0x80) b.unshift(0);
  return tlv(0x02, b);
};
const encOid = (oid) => {
  const p = oid.split('.').map(Number);
  const out = [40 * p[0] + p[1]];
  for (let i = 2; i < p.length; i++) {
    let v = p[i];
    const t = [];
    do { t.unshift(v & 0x7f); v >>= 7; } while (v > 0);
    for (let j = 0; j < t.length - 1; j++) t[j] |= 0x80;
    out.push(...t);
  }
  return tlv(0x06, out);
};
const encStr = (s) => tlv(0x04, Buffer.from(s, 'utf8'));
const encTicks = (n) => {
  const b = [];
  let v = n;
  while (v > 0) { b.unshift(v & 0xff); v >>= 8; }
  return tlv(0x43, b);
};

function readTlv(buf, off) {
  const tag = buf[off++];
  let l = buf[off++];
  if (l & 0x80) {
    const n = l & 0x7f;
    l = 0;
    for (let i = 0; i < n; i++) l = (l << 8) | buf[off++];
  }
  return { tag, start: off, end: off + l };
}
function decOid(buf) {
  const p = [Math.floor(buf[0] / 40), buf[0] % 40];
  let v = 0;
  for (let i = 1; i < buf.length; i++) {
    v = (v << 7) | (buf[i] & 0x7f);
    if (!(buf[i] & 0x80)) { p.push(v); v = 0; }
  }
  return p.join('.');
}
function parseRequest(buf) {
  const outer = readTlv(buf, 0);
  let o = outer.start;
  const ver = readTlv(buf, o); o = ver.end;
  const com = readTlv(buf, o); o = com.end;
  const pdu = readTlv(buf, o);
  let p = pdu.start;
  const id = readTlv(buf, p); p = id.end;
  const err = readTlv(buf, p); p = err.end;
  const idx = readTlv(buf, p); p = idx.end;
  const vbl = readTlv(buf, p);
  const oids = [];
  let q = vbl.start;
  while (q < vbl.end) {
    const vb = readTlv(buf, q);
    const ot = readTlv(buf, vb.start);
    oids.push(decOid(buf.subarray(ot.start, ot.end)));
    q = vb.end;
  }
  const reqId = buf.subarray(id.start, id.end).reduce((n, b) => (n << 8) | b, 0);
  return { reqId, oids };
}

const VALUES = {
  '1.3.6.1.2.1.1.1.0': encStr('H3C S5130S-28S-EI Comware Software, Version 7.1.070'),
  '1.3.6.1.2.1.1.5.0': encStr('SW-TEST-01'),
  '1.3.6.1.2.1.1.3.0': encTicks(123456),
  '1.3.6.1.2.1.25.3.3.1.2.1': encInt(23),
};

function buildResponse(reqId, oids) {
  const vbs = oids.map((oid) => tlv(0x30, Buffer.concat([encOid(oid), VALUES[oid] || tlv(0x05, [])])));
  const pdu = tlv(0xA2, Buffer.concat([encInt(reqId), encInt(0), encInt(0), tlv(0x30, Buffer.concat(vbs))]));
  return tlv(0x30, Buffer.concat([encInt(1), encStr('public'), pdu]));
}

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
};

const post = async (path, body) => {
  const r = await fetch(`${API}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return r.json();
};

/* ---------------- mock SNMP agent on 1161 ---------------- */
const snmp = dgram.createSocket('udp4');
await new Promise((res) => snmp.bind(1161, '127.0.0.1', res));
snmp.on('message', (msg, rinfo) => {
  const { reqId, oids } = parseRequest(msg);
  snmp.send(buildResponse(reqId, oids), rinfo.port, rinfo.address);
});

/* ---------------- mock Redfish on 18080 ---------------- */
const rf = http.createServer((req, res) => {
  const send = (obj, code = 200) => {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(obj));
  };
  if (req.url === '/redfish/v1/Systems') return send({ Members: [{ '@odata.id': '/redfish/v1/Systems/1' }] });
  if (req.url === '/redfish/v1/Systems/1') {
    return send({
      Model: 'PowerEdge R750', PowerState: 'On', HostName: 'esxi-01',
      Status: { Health: 'OK' },
      ProcessorSummary: { Count: 2 }, MemorySummary: { TotalSystemMemoryGiB: 64 },
    });
  }
  if (req.url === '/redfish/v1/Chassis') return send({ Members: [{ '@odata.id': '/redfish/v1/Chassis/1' }] });
  if (req.url === '/redfish/v1/Chassis/1/Thermal') {
    return send({ Temperatures: [{ ReadingCelsius: 38 }, { ReadingCelsius: 42 }] });
  }
  return send({ error: 'not found' }, 404);
});
await new Promise((res) => rf.listen(18080, '127.0.0.1', res));

/* ---------------- run checks ---------------- */
try {
  const snmpRes = await post('/api/snmp', { host: '127.0.0.1', port: 1161, community: 'public' });
  const map = Object.fromEntries((snmpRes.varbinds || []).map((v) => [v.name, v.value]));
  check('SNMP 采集 sysDescr', snmpRes.ok && /H3C/.test(map.sysDescr || ''), map.sysDescr);
  check('SNMP 采集 CPU', map.hrProcessorLoad === 23, String(map.hrProcessorLoad));

  const rfRes = await post('/api/redfish', { host: '127.0.0.1', port: 18080, user: 'admin', password: 'x', secure: false });
  check('Redfish 型号', rfRes.ok && rfRes.model === 'PowerEdge R750', rfRes.model);
  check('Redfish 电源状态', rfRes.powerState === 'On');
  check('Redfish CPU/内存', rfRes.cpuCount === 2 && rfRes.memGiB === 64, `${rfRes.cpuCount} / ${rfRes.memGiB}`);
  check('Redfish 温度', rfRes.tempC === 42, String(rfRes.tempC));

  const bad = await post('/api/snmp', { host: 'no-such-host.local', community: 'public' });
  check('SNMP 错误回显', bad.ok === false && !!bad.error, bad.error);

  // LLDP parser
  const cdp = `Device ID: SW-A01-01\n  Port ID (outgoing port): GigabitEthernet1/0/1`;
  const table = `GE1/0/1            00e0-fc12-3456   GE1/0/2          SW-B02-03`;
  check('LLDP Cisco 解析', parseLldp(cdp).some((n) => n.remote === 'SW-A01-01'));
  check('LLDP 表格式解析', parseLldp(table).some((n) => n.remote === 'SW-B02-03'), JSON.stringify(parseLldp(table)));
  check('LLDP 空输入', parseLldp('').length === 0);
} catch (err) {
  check('测试执行', false, err.message);
} finally {
  snmp.close();
  rf.close();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
