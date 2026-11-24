/**
 * Health-check / audit and local diagnosis.
 * Mirrors the "健康检查" + "AI 智能分析" modules of NetDevOps-Toolbox-V1,
 * implemented as deterministic rules over the live simulation (no cloud LLM).
 */
import { hostName, mgmtIp, peerOf, vendor } from './vendors.js';

const SEV_ORDER = { critical: 3, major: 2, minor: 1, ok: 0 };

export function auditDevice(app, dev) {
  const rack = app.state.racks.find((r) => r.id === dev.rackId);
  const cables = Object.values(app.state.cables).filter((c) => c.a.devId === dev.id || c.b.devId === dev.id);
  const errs = dev.ports.reduce((n, p) => n + (p.errors || 0), 0);
  const cabledDown = dev.ports.filter((p) => p.cable && p.state !== 'up').length;
  const checks = [];

  const add = (key, label, ok, level, detail) => checks.push({ key, label, ok, level, detail });

  add('power', '设备在线', dev.adminPower && dev.status === 'online', 'critical',
    dev.status === 'offline' ? '设备离线' : dev.status === 'rebooting' ? '正在重启' : '在线');
  add('cpu', 'CPU 负载', dev.metrics.cpu < 85, 'major', `CPU ${Math.round(dev.metrics.cpu)}%`);
  add('mem', '内存水位', dev.metrics.mem < 90, 'minor', `内存 ${Math.round(dev.metrics.mem)}%`);
  add('temp', '设备温度', dev.metrics.temp < 38, 'major', `${dev.metrics.temp.toFixed(1)} ℃（机柜 ${(rack?.temp || 22).toFixed(1)} ℃）`);
  add('fan', '散热风扇', !dev.flags.fanFail, 'critical', dev.flags.fanFail ? '风扇故障' : '正常');
  add('errors', '端口错误', errs < 500, 'major', `累计 ${Math.round(errs)} 次 CRC/丢包`);
  add('links', '链路一致性', cabledDown === 0, 'minor', cabledDown ? `${cabledDown} 条已布线链路未 UP` : '全部 UP');
  add('power-rack', '机柜功率', !rack || (rack.power || 0) < (rack.powerCap || 8) * 0.9, 'minor',
    rack ? `${(rack.power || 0).toFixed(2)} / ${rack.powerCap || 8} kW` : '—');

  let score = 100;
  const findings = [];
  for (const c of checks) {
    if (c.ok) continue;
    score -= c.level === 'critical' ? 45 : c.level === 'major' ? 15 : 5;
    findings.push(c);
  }
  score = Math.max(0, Math.min(100, score));

  return {
    devId: dev.id,
    name: dev.name,
    host: hostName(dev, app.state),
    rack: rack?.name || '—',
    ip: mgmtIp(dev, app.state),
    vendor: vendor(dev).label,
    score,
    status: findings.some((f) => f.level === 'critical') ? 'fail' : findings.length ? 'warn' : 'pass',
    checks,
    findings,
    cables: cables.length,
  };
}

export function auditAll(app) {
  const rows = Object.values(app.state.devices)
    .filter((d) => vendor(d).cli)
    .map((d) => auditDevice(app, d))
    .sort((a, b) => a.score - b.score);
  const summary = {
    total: rows.length,
    pass: rows.filter((r) => r.status === 'pass').length,
    warn: rows.filter((r) => r.status === 'warn').length,
    fail: rows.filter((r) => r.status === 'fail').length,
    avg: rows.length ? Math.round(rows.reduce((n, r) => n + r.score, 0) / rows.length) : 100,
    critical: rows.reduce((n, r) => n + r.findings.filter((f) => f.level === 'critical').length, 0),
  };
  return { rows, summary };
}

export function buildReport(app, audit) {
  const { rows, summary } = audit;
  const ts = new Date().toLocaleString('zh-CN', { hour12: false });
  const lines = [
    '# NEXUS DC 网络健康检查报告',
    '',
    `- 生成时间：${ts}`,
    `- 设备总数：${summary.total}（通过 ${summary.pass} / 关注 ${summary.warn} / 异常 ${summary.fail}）`,
    `- 平均健康分：${summary.avg}`,
    `- 严重问题：${summary.critical}`,
    '',
    '## 明细',
    '',
    '| 设备 | 主机名 | 机柜 | 厂商 | 评分 | 状态 | 主要问题 |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...rows.map((r) => `| ${r.name} | ${r.host} | ${r.rack} | ${r.vendor} | ${r.score} | ${r.status} | ${r.findings[0]?.label || '—'} |`),
    '',
    '## 问题清单',
    '',
  ];
  const problems = rows.flatMap((r) => r.findings.map((f) => ({ r, f })));
  if (!problems.length) lines.push('无异常项。');
  for (const { r, f } of problems) {
    lines.push(`- [${f.level}] ${r.name}（${r.rack}）：${f.label} — ${f.detail}`);
  }
  lines.push('', '---', '由 NEXUS DC NetDevOps 工具箱生成；规则参考 NetDevOps-Toolbox-V1 健康检查模型。');
  return lines.join('\n');
}

/* ------------------------------------------------------------------ *
 *  Diagnosis
 * ------------------------------------------------------------------ */
export function diagnose(app, dev) {
  const rack = app.state.racks.find((r) => r.id === dev.rackId);
  const peers = [];
  for (const p of dev.ports) {
    const peer = peerOf(app, dev, p);
    if (peer) peers.push({ peer, port: p });
  }
  const alarms = app.sim.alarmsList.filter((a) => a.targetId === dev.id);
  const findings = [];
  const cmds = new Set();
  const v = vendor(dev);
  const isNet = v.family === 'comware' || v.family === 'ios';
  const intfCmd = isNet ? (v.family === 'ios' ? 'show interfaces status' : 'display interface brief') : 'ip a';
  const envCmd = isNet ? (v.family === 'ios' ? 'show environment all' : 'display environment') : 'sensors';

  const push = (title, sev, evidence, cause, actions = []) => findings.push({ title, sev, evidence, cause, actions });

  if (!dev.adminPower || dev.status === 'offline') {
    push('设备离线 / 业务中断', 'critical',
      `心跳丢失，最后状态 ${dev.status}，${dev.ports.filter((p) => p.cable).length} 条链路受影响`,
      '电源掉电、PDU 分路跳闸或上联中断可能性最高',
      [{ label: '远程上电', act: 'powerOn' }, { label: '尝试修复', act: 'repair' }]);
    cmds.add('display device');
    cmds.add(envCmd);
    cmds.add(intfCmd);
  }
  if (dev.status === 'rebooting') {
    push('设备重启中', 'minor', '控制平面正在重新加载配置，业务可能短时中断', '计划内重启或崩溃自愈', []);
  }
  if (dev.flags.fanFail) {
    push('风扇故障', 'critical', '风扇转速为 0，散热能力下降，温度将持续上升', '风扇模块故障或供电异常',
      [{ label: '更换/修复风扇', act: 'repair' }]);
    cmds.add(envCmd);
  }
  if (dev.flags.overheat > 0 || dev.metrics.temp > 38) {
    push('过热风险', 'major', `设备温度 ${dev.metrics.temp.toFixed(1)} ℃，机柜进风 ${(rack?.temp || 22).toFixed(1)} ℃`,
      '机柜制冷不足、冷热通道串流或盲板缺失',
      rack ? [{ label: '机柜应急制冷', act: 'cool' }] : []);
    cmds.add(envCmd);
  }
  if (dev.flags.congestion || dev.metrics.cpu > 85) {
    push('转发面拥塞', 'major', `CPU ${Math.round(dev.metrics.cpu)}%，吞吐 ${dev.metrics.throughput.toFixed(1)} Gbps`,
      '流量突发、广播风暴或上行带宽不足', []);
    if (isNet) cmds.add(v.family === 'ios' ? 'show processes cpu' : 'display cpu-usage');
  }
  const errPorts = dev.ports.filter((p) => p.errors > 500 || (dev.flags.loss && dev.flags.lossPort === p.id));
  if (errPorts.length) {
    const p = errPorts[0];
    push('链路误码 / 丢包', 'major', `${p.label} 累计错误 ${Math.round(p.errors)} 次，端口状态 ${p.state}`,
      '光模块衰减、跳线接触不良或对端网卡异常',
      [{ label: '端口恢复', act: 'repair' }]);
    if (isNet) cmds.add(v.family === 'ios' ? 'show interfaces' : 'display interface');
  }
  const downLinks = dev.ports.filter((p) => p.cable && p.state !== 'up');
  if (!findings.length && downLinks.length) {
    push('部分链路未 UP', 'minor', `${downLinks.length} 条已布线链路处于 down`, '对端未上电或端口被 shutdown', []);
    cmds.add(intfCmd);
  }
  if (rack && (rack.power || 0) > (rack.powerCap || 8) * 0.9) {
    push('机柜功率接近上限', 'minor', `${(rack.power || 0).toFixed(2)} / ${rack.powerCap || 8} kW`,
      '新增设备或冗余电源策略导致负载偏高', []);
  }

  if (!findings.length) {
    push('运行健康', 'ok', `CPU ${Math.round(dev.metrics.cpu)}% · 内存 ${Math.round(dev.metrics.mem)}% · ${dev.metrics.temp.toFixed(1)} ℃`,
      '所有受检项均在阈值内，无需处置', []);
    cmds.add(isNet ? 'display version' : 'uname -a');
  }

  const score = Math.max(0, 100
    - findings.reduce((n, f) => n + (f.sev === 'critical' ? 45 : f.sev === 'major' ? 18 : f.sev === 'minor' ? 7 : 0), 0));

  return {
    device: dev,
    title: hostName(dev, app.state),
    ip: mgmtIp(dev, app.state),
    score,
    verdict: score >= 90 ? '健康' : score >= 60 ? '需关注' : '风险',
    findings,
    commands: [...cmds],
    peers: peers.slice(0, 8).map((x) => ({ name: x.peer.name, port: x.port.label })),
    alarms,
    summary: findings[0]?.title || '运行健康',
    sev: SEV_ORDER[findings[0]?.sev] ? findings[0].sev : 'ok',
  };
}
