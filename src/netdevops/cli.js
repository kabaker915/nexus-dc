/**
 * Simulated multi-vendor CLI (the "Web SSH 终端" of NetDevOps-Toolbox-V1,
 * re-implemented against the live datacenter state instead of real devices).
 */
import {
  MGMT_GATEWAY, NTP_SERVER, SYSLOG_SERVER, VLAN_NAMES,
  hostName, mgmtIp, peerOf, pseudo, vendor, vendorKey,
} from './vendors.js';
import { buildConfig } from './config.js';

const pad = (s, n) => String(s).padEnd(n);
const padl = (s, n) => String(s).padStart(n);
const now = () => new Date();

function briefName(port, i) {
  if (port.kind === 'qsfp' || port.speed >= 100) return `HGE1/0/${i + 1}`;
  if (port.kind === 'sfp' && port.speed >= 25) return `25GE1/0/${i + 1}`;
  if (port.kind === 'sfp') return `XGE1/0/${i + 1}`;
  return `GE1/0/${i + 1}`;
}

function stateOf(p) {
  if (p.state === 'up') return 'UP';
  if (p.state === 'err') return 'ERR';
  return 'DOWN';
}

function uptime(dev) {
  const days = 3 + Math.floor(pseudo(dev, 1) * 210);
  const h = Math.floor(pseudo(dev, 2) * 24);
  const m = Math.floor(pseudo(dev, 3) * 60);
  return `${Math.floor(days / 7)} weeks, ${days % 7} days, ${h} hours, ${m} minutes`;
}

function serial(dev) {
  const s = Math.floor(pseudo(dev, 5) * 0xfffff).toString(16).toUpperCase().padStart(5, '0');
  return `210235A${s}`;
}

function cpu(dev) {
  return Math.round(dev.metrics.cpu);
}

function mem(dev) {
  return Math.round(dev.metrics.mem);
}

function intfBrief(app, dev) {
  const rows = [];
  if (vendorKey(dev) === 'cisco') {
    rows.push(pad('Interface', 26) + pad('IP-Address', 16) + pad('OK?', 5) + pad('Method', 8) + pad('Status', 20) + 'Protocol');
    dev.ports.forEach((p, i) => {
      const up = p.state === 'up';
      rows.push(
        pad(`GigabitEthernet1/0/${i + 1}`, 26) +
        pad(i === 0 ? mgmtIp(dev, app.state) : 'unassigned', 16) +
        pad('YES', 5) + pad('unset', 8) +
        pad(up ? 'up' : 'administratively down', 20) +
        (up ? 'up' : 'down'),
      );
    });
    rows.push('');
    rows.push(`${dev.ports.filter((p) => p.state === 'up').length} interfaces up, ${dev.ports.filter((p) => p.state !== 'up').length} down`);
    return rows;
  }
  rows.push(pad('Interface', 18) + pad('Link', 7) + pad('Speed', 9) + pad('Duplex', 8) + pad('Type', 5) + pad('PVID', 6) + 'Description');
  dev.ports.forEach((p, i) => {
    const peer = peerOf(app, dev, p);
    const vlan = peer?.kind === 'server1u' ? '20' : peer?.kind === 'server2u' ? '30'
      : peer?.kind === 'storage4u' ? '40' : peer?.kind === 'firewall' ? '50' : '1';
    rows.push(
      pad(briefName(p, i), 18) +
      pad(stateOf(p), 7) +
      pad(p.state === 'up' ? `${p.speed}G` : 'auto', 9) +
      pad('Full', 8) + pad('A', 5) + pad(vlan, 6) +
      (peer ? `To-${hostName(peer, app.state)}` : 'unused'),
    );
  });
  return rows;
}

function routeTable(app, dev) {
  const ip = mgmtIp(dev, app.state);
  const net = ip.split('.').slice(0, 3).join('.');
  if (vendorKey(dev) === 'cisco') {
    return [
      'Codes: L - local, C - connected, S - static, O - OSPF',
      'Gateway of last resort is 10.10.0.1 to network 0.0.0.0',
      '',
      'S*    0.0.0.0/0 [1/0] via 10.10.0.1',
      `C     ${net}.0/24 is directly connected, Vlan10`,
      `L     ${ip}/32 is directly connected, Vlan10`,
      dev.kind === 'router' ? 'O     10.0.0.0/24 [110/2] via 10.0.0.2, 4d02h, Hu0/1' : 'O     10.0.0.0/24 [110/2] via 10.10.0.1, 4d02h, Vlan10',
    ];
  }
  return [
    pad('Destination/Mask', 22) + pad('Proto', 9) + pad('Pre', 5) + pad('Cost', 6) + pad('NextHop', 17) + 'Interface',
    pad('0.0.0.0/0', 22) + pad('Static', 9) + pad('60', 5) + pad('0', 6) + pad(MGMT_GATEWAY, 17) + 'Vlan-interface10',
    pad(`${net}.0/24`, 22) + pad('Direct', 9) + pad('0', 5) + pad('0', 6) + pad(ip, 17) + 'Vlan-interface10',
    pad(`${ip}/32`, 22) + pad('Direct', 9) + pad('0', 5) + pad('0', 6) + pad('127.0.0.1', 17) + 'InLoop0',
    pad('10.0.0.0/24', 22) + pad('OSPF', 9) + pad('10', 5) + pad('2', 6) + pad('10.10.0.1', 17) + 'Vlan-interface10',
  ];
}

function neighbors(app, dev) {
  const rows = [];
  dev.ports.forEach((p, i) => {
    const peer = peerOf(app, dev, p);
    if (!peer) return;
    const other = app.state.cables[p.cable];
    const peerPortId = other.a.devId === dev.id ? other.b.portId : other.a.portId;
    const peerPort = peer.ports.find((x) => x.id === peerPortId);
    rows.push(
      pad(briefName(p, i), 18) +
      pad(`00e0-fc${String(Math.floor(pseudo(peer, 7) * 0xffff)).padStart(4, '0')}`, 20) +
      pad(peerPort?.label || '-', 16) +
      hostName(peer, app.state),
    );
  });
  if (!rows.length) return ['(no LLDP neighbors)'];
  return [pad('Local Interface', 18) + pad('Chassis ID', 20) + pad('Port ID', 16) + 'System Name', ...rows];
}

function envOutput(app, dev) {
  const rack = app.state.racks.find((r) => r.id === dev.rackId);
  const inlet = (rack?.temp || 22).toFixed(1);
  const outlet = (Number(inlet) + 4.2).toFixed(1);
  if (vendorKey(dev) === 'cisco') {
    return [
      'Environment Monitoring:',
      `  Inlet Temperature:   ${inlet} C`,
      `  Outlet Temperature:  ${outlet} C`,
      '  Fan Tray 1:          Ok          7200 RPM',
      '  Power Supply 1:      Ok          Ok',
      `  System Temperature:  ${Math.round(dev.metrics.temp)} C  (${dev.metrics.temp > 38 ? 'ALARM' : 'Normal'})`,
    ];
  }
  return [
    'Slot  Sensor   Status  Temperature(C)  Lower  Warning  Alarm',
    `1     Inlet    Normal  ${pad(inlet, 15)}-5     45       60`,
    `1     Outlet   Normal  ${pad(outlet, 15)}-5     55       70`,
    `1     CPU      ${dev.metrics.temp > 38 ? 'Alarm ' : 'Normal '}  ${pad(dev.metrics.temp.toFixed(1), 15)}0      60       75`,
    '',
    `Fan 1    ${dev.flags.fanFail ? 'Absent' : 'Normal'}    ${dev.flags.fanFail ? 0 : 8200} rpm`,
    `Power 1  Normal    ${(dev.metrics.power / 1000).toFixed(2)} kW`,
  ];
}

function arpTable(app, dev) {
  const rows = [pad('IP Address', 17) + pad('MAC Address', 20) + pad('VLAN', 6) + 'Interface'];
  app.state.racks.forEach((rack, ri) => {
    rack.devices.slice(0, 3).forEach((id, di) => {
      const d = app.state.devices[id];
      if (!d) return;
      rows.push(pad(`10.10.${ri + 1}.${10 + di + 1}`, 17) + pad(`00e0-fc${String((ri * 31 + di * 7) % 9999).padStart(4, '0')}`, 20) + pad('10', 6) + 'GE1/0/1');
    });
  });
  return rows;
}

function findDeviceByIp(app, ip) {
  for (const d of Object.values(app.state.devices)) {
    if (mgmtIp(d, app.state) === ip) return d;
  }
  return null;
}

function ping(app, target) {
  const ip = target.trim();
  const known = ip === MGMT_GATEWAY || ip === NTP_SERVER || ip === SYSLOG_SERVER || !!findDeviceByIp(app, ip);
  const lines = [`PING ${ip}: 56 data bytes, press CTRL_C to break`];
  if (!known) {
    lines.push('Request time out');
    lines.push('Request time out');
    lines.push('');
    lines.push(`--- ${ip} ping statistics ---`);
    lines.push('5 packet(s) transmitted, 0 packet(s) received, 100.0% packet loss');
    return lines;
  }
  let min = 999;
  let max = 0;
  for (let i = 0; i < 5; i++) {
    const t = Math.round((0.4 + Math.random() * 1.8) * 100) / 100;
    min = Math.min(min, t);
    max = Math.max(max, t);
    lines.push(`Reply from ${ip}: bytes=56 Sequence=${i + 1} ttl=254 time=${Math.round(t * 10)} ms`);
  }
  return [...lines, '', `--- ${ip} ping statistics ---`, '5 packet(s) transmitted, 5 packet(s) received, 0.0% packet loss',
    `round-trip min/avg/max = ${Math.round(min * 10)}/${Math.round(((min + max) / 2) * 10)}/${Math.round(max * 10)} ms`];
}

function cliVersion(app, dev) {
  const k = vendorKey(dev);
  const host = hostName(dev, app.state);
  const up = uptime(dev);
  if (k === 'cisco') {
    return [
      'Cisco IOS XE Software, Version 17.09.04a',
      'Cisco IOS Software [Cupertino], Catalyst L3 Switch Software (CAT9K_IOSXE), Version 17.9.4a, RELEASE SOFTWARE (fc1)',
      'Technical Support: http://www.cisco.com/techsupport',
      `${host} uptime is ${up}`,
      'System returned to ROM by reload',
      'System image file is "flash:cat9k_iosxe.17.09.04a.SPA.bin"',
      '',
      `cisco C9300-48P (X86) processor with ${Math.round(pseudo(dev, 9) * 2 + 2)}G bytes of memory.`,
      `Processor board ID FOC${serial(dev)}`,
    ];
  }
  if (k === 'huawei') {
    return [
      'Huawei Versatile Routing Platform Software',
      'VRP (R) software, Version 8.180 (CE6865 V200R019C10SPC800)',
      'Copyright (C) 2012-2024 Huawei Technologies Co., Ltd.',
      `HUAWEI ${host} uptime is ${up}`,
      '',
      `BKP 1: ${serial(dev)}`,
      'MPU 1: 4-core, 8G memory, 1G flash',
      `System total memory: 8192 MB, used ${mem(dev)}%`,
    ];
  }
  return [
    'H3C Comware Software, Version 7.1.070, Release 3506P02',
    'Copyright (c) 2004-2024 New H3C Technologies Co., Ltd. All rights reserved.',
    `H3C ${host} uptime is ${up}`,
    'Last reboot reason : User reboot',
    '',
    'Boot image: flash:/nx-4820t-cmw710-boot.bin',
    'System image: flash:/nx-4820t-cmw710-system.bin',
    `CPU type:   Intel Atom C3558 4-Core 2200MHz`,
    `512M bytes DDR4 SDRAM Memory`,
    `Serial number: ${serial(dev)}`,
  ];
}

function cliCpu(dev) {
  if (vendorKey(dev) === 'cisco') {
    const c = cpu(dev);
    return [
      `CPU utilization for five seconds: ${c}%/2%; one minute: ${Math.max(1, c - 3)}%; five minutes: ${Math.max(1, c - 5)}%`,
      'Core 0:  CPU utilization for five seconds: 2%',
    ];
  }
  const c = cpu(dev);
  return [
    'Slot 1 CPU usage:',
    `        ${c}% in last 5 seconds`,
    `        ${Math.max(1, c - 2)}% in last 1 minute`,
    `        ${Math.max(1, c - 3)}% in last 5 minutes`,
  ];
}

function cliMem(dev) {
  const total = dev.kind === 'storage4u' ? 65536 : dev.kind === 'router' ? 8192 : 2048;
  const used = Math.round((mem(dev) / 100) * total);
  if (vendorKey(dev) === 'cisco') {
    return [
      '                Head    Total(b)     Used(b)     Free(b)   Lowest(b)  Largest(b)',
      `Processor    7f8c4a0   ${padl(total * 1024 * 1024, 12)}  ${padl(used * 1024 * 1024, 11)}  ${padl((total - used) * 1024 * 1024, 10)}  1180000000  900000000`,
    ];
  }
  return [
    `System Total Memory: ${total} MB`,
    `Total Used Memory: ${used} MB`,
    `Used Rate: ${mem(dev)}%`,
    `Free Memory: ${total - used} MB`,
  ];
}

function helpText(dev) {
  const k = vendorKey(dev);
  if (k === 'linux') {
    return [
      '支持的命令：',
      '  uname -a | hostnamectl | uptime | cat /etc/os-release',
      '  ip a | ip route | ss -lntp | ethtool -S eth0',
      '  free -h | df -h | top -bn1 | sensors',
      '  clear | help',
    ];
  }
  return [
    '支持的命令：',
    `  ${k === 'cisco' ? 'show' : 'display'} version / current-configuration / clock`,
    `  ${k === 'cisco' ? 'show' : 'display'} interface brief / interface`,
    `  ${k === 'cisco' ? 'show' : 'display'} ip routing-table / arp`,
    `  ${k === 'cisco' ? 'show' : 'display'} cpu-usage / memory / environment`,
    `  ${k === 'cisco' ? 'show' : 'display'} lldp neighbor-information`,
    '  ping <IP> | save | reboot | clear | help',
  ];
}

function unknown(dev, line) {
  const k = vendorKey(dev);
  if (k === 'cisco') return [`% Invalid input detected at '^' marker.`, '', `  ${line}`, '  ^'];
  if (k === 'huawei') return [`Error: Unrecognized command found at '^' position.`];
  return [`% Unrecognized command found at '^' position.`];
}

const REBOOT_PENDING = new Set();

/** Execute one CLI line. Returns {lines, clear}. */
export function runCli(app, dev, raw) {
  const line = String(raw || '').trim();
  if (!line) return { lines: [] };
  const k = vendorKey(dev);
  const v = vendor(dev);
  const lower = line.toLowerCase();

  if (lower === 'clear') return { lines: [], clear: true };
  if (lower === 'help' || lower === '?') return { lines: helpText(dev) };

  if (v.family === 'linux') {
    return { lines: linuxCommand(app, dev, lower, line) };
  }

  if (lower === 'ping' || lower.startsWith('ping ')) {
    return { lines: ping(app, line.split(/\s+/)[1] || MGMT_GATEWAY) };
  }

  if (lower === 'save' || lower === 'write memory' || lower === 'copy running-config startup-config') {
    if (k === 'cisco') return { lines: ['Building configuration...', 'Compressed configuration from 4821 bytes to 2190 bytes[OK]'] };
    return { lines: ['Validating file. Please wait...', 'Saved the current configuration to mainboard device successfully.', 'Configuration is saved to device successfully.'] };
  }

  if (lower === 'reboot') {
    if (!REBOOT_PENDING.has(dev.id)) {
      REBOOT_PENDING.add(dev.id);
      return { lines: ['Warning: All the configuration will be saved to the configuration file, Continue? [Y/N]:', "Type 'reboot confirm' to reboot the device."] };
    }
    REBOOT_PENDING.delete(dev.id);
    app.deviceAction(dev, 'reboot');
    return { lines: ['System is rebooting...', 'Connection to the device lost.'] };
  }
  if (lower === 'reboot confirm' && REBOOT_PENDING.has(dev.id)) {
    REBOOT_PENDING.delete(dev.id);
    app.deviceAction(dev, 'reboot');
    return { lines: ['System is rebooting...', 'Connection to the device lost.'] };
  }

  const isCisco = k === 'cisco';
  const show = isCisco ? 'show' : 'display';

  if (lower === `${show} version` || lower === 'display version') {
    return { lines: cliVersion(app, dev) };
  }
  if (lower === `${show} clock` || lower === 'display clock') {
    return { lines: [`${now().toISOString().replace('T', ' ').slice(0, 19)} UTC+08:00`, 'Time Zone : China Standard Time'] };
  }
  if (lower === `${show} device` || lower === 'display device') {
    return {
      lines: [
        'Slot  Type                State     Subslot  Online  Power  Role',
        `1     ${dev.model.padEnd(20)}Normal    0        Yes     OK     Master`,
        `      Uptime: ${uptime(dev)}`,
        `      Temperature: ${dev.metrics.temp.toFixed(1)} C`,
      ],
    };
  }
  if (lower === 'display current-configuration' || lower === 'show running-config' || lower === 'display saved-configuration' || lower === 'show startup-config') {
    return { lines: buildConfig(app, dev).split('\n') };
  }
  if (lower === 'display interface brief' || lower === 'display ip interface brief' || lower === 'show ip interface brief' || lower === 'show interfaces status' || lower === 'show interfaces') {
    return { lines: intfBrief(app, dev) };
  }
  if (lower === 'display port trunk' || lower === 'display port vlan' || lower === 'show interfaces trunk') {
    return {
      lines: [
        pad('Interface', 18) + pad('Mode', 8) + pad('PVID', 6) + 'Trunk VLANs',
        ...dev.ports.filter((p) => p.cable && peerOf(app, dev, p)?.kind.startsWith('switch')).map((p, i) =>
          pad(briefName(p, i), 18) + pad('trunk', 8) + pad('1', 6) + '10 20 30 40 50'),
      ],
    };
  }
  if (lower.startsWith('display interface ') || lower.startsWith('show interface ')) {
    const idx = dev.ports.findIndex((p, i) => lower.includes(briefName(p, i).toLowerCase()) || lower.includes(`1/0/${i + 1}`));
    const p = dev.ports[idx];
    if (!p) return { lines: ['Error: interface not found (示例终端按 1/0/<n> 匹配)'] };
    return {
      lines: [
        `${briefName(p, idx)} current state : ${p.state.toUpperCase()}`,
        `Line protocol state : ${p.state === 'up' ? 'UP' : 'DOWN'}`,
        `Description : ${peerOf(app, dev, p) ? 'To-' + hostName(peerOf(app, dev, p), app.state) : 'unused'}`,
        `Bandwidth : ${p.speed * 1000} Mbps`,
        `Input errors: ${Math.round(p.errors)}, CRC: ${Math.round(p.errors * 0.6)}`,
        `Input rate : ${(p.rx * 1000).toFixed(0)} kbps, Output rate : ${(p.tx * 1000).toFixed(0)} kbps`,
        `Utilization : ${(p.util * 100).toFixed(1)}%`,
      ],
    };
  }
  if (lower === 'display ip routing-table' || lower === 'show ip route' || lower === 'display ip routing-table statistics' || lower === 'show ip route summary') {
    return { lines: routeTable(app, dev) };
  }
  if (lower === 'display arp' || lower === 'show arp') {
    return { lines: arpTable(app, dev) };
  }
  if (lower === 'display vlan' || lower === 'display vlan brief' || lower === 'show vlan brief' || lower === 'show vlan' || lower === 'display vlan summary') {
    const lines = [pad('VLAN ID', 8) + pad('Name', 14) + 'Ports'];
    for (const id of [10, 20, 30, 40, 50]) {
      const ports = dev.ports.filter((p, i) => {
        const peer = peerOf(app, dev, p);
        const vlan = peer?.kind === 'server1u' ? 20 : peer?.kind === 'server2u' ? 30 : peer?.kind === 'storage4u' ? 40 : 0;
        return vlan === id;
      }).length;
      lines.push(pad(id, 8) + pad(VLAN_NAMES[id], 14) + (ports ? `${ports} ports` : '—'));
    }
    return { lines };
  }
  if (lower === 'display mac-address-table' || lower === 'display mac-address' || lower === 'show mac address-table') {
    return {
      lines: [
        pad('MAC Address', 20) + pad('VLAN', 6) + pad('Type', 10) + 'Port',
        ...dev.ports.filter((p) => p.state === 'up').slice(0, 8).map((p, i) =>
          pad(`00e0-fc${String((i * 977) % 9999).padStart(4, '0')}`, 20) + pad('20', 6) + pad('dynamic', 10) + briefName(p, i)),
      ],
    };
  }
  if (lower === 'display cpu-usage' || lower === 'display cpu' || lower === 'show processes cpu') {
    return { lines: cliCpu(dev) };
  }
  if (lower === 'display memory' || lower === 'display memory-usage' || lower === 'show memory statistics') {
    return { lines: cliMem(dev) };
  }
  if (lower === 'display environment' || lower === 'show environment all') {
    return { lines: envOutput(app, dev) };
  }
  if (lower === 'display lldp neighbor-information' || lower === 'show cdp neighbors' || lower === 'display lldp neighbor' || lower === 'show lldp neighbors') {
    return { lines: neighbors(app, dev) };
  }
  if (lower === 'display ospf peer' || lower === 'display ospf brief' || lower === 'show ip ospf neighbor' || lower === 'show ip ospf brief') {
    return {
      lines: [
        'OSPF Process 1 with Router ID ' + mgmtIp(dev, app.state),
        'Area: 0.0.0.0',
        pad('Neighbor ID', 18) + pad('State', 10) + pad('Address', 18) + 'Interface',
        pad('10.255.0.1', 18) + pad('Full', 10) + pad('10.10.0.1', 18) + 'Vlan-interface10',
      ],
    };
  }
  if (lower === 'display bgp peer' || lower === 'show ip bgp summary') {
    return { lines: ['BGP local router ID: ' + mgmtIp(dev, app.state), 'Total number of peers: 1', pad('Peer', 18) + pad('AS', 8) + pad('State', 12) + 'Up/Down', pad('10.0.0.254', 18) + pad('65001', 8) + pad('Established', 12) + '12d03h'] };
  }
  if (lower === 'display stp brief' || lower === 'show spanning-tree brief') {
    return {
      lines: [
        pad('MSTID', 8) + pad('Port', 18) + pad('Role', 10) + 'STP State',
        ...dev.ports.filter((p) => p.state === 'up').slice(0, 6).map((p, i) =>
          pad('0', 8) + pad(briefName(p, i), 18) + pad(i === 0 ? 'ROOT' : 'DESI', 10) + 'FORWARDING'),
      ],
    };
  }
  if (lower === 'display acl all' || lower === 'show access-lists') {
    return {
      lines: [
        'Basic ACL 2000, 2 rules',
        ' rule 5 permit source 10.10.0.0 0.0.255.255',
        ' rule 10 deny',
        'Advanced ACL 3000, 3 rules',
        ' rule 5 permit tcp destination-port eq 22',
        ' rule 10 permit tcp destination-port eq 443',
        ' rule 100 deny ip',
      ],
    };
  }
  if (lower === 'display user-interface' || lower === 'show users') {
    return { lines: [pad('UI', 8) + pad('Type', 10) + pad('User', 16) + 'Location', pad('VTY 0', 8) + pad('SSH', 10) + pad('netops', 16) + '10.10.0.100'] };
  }
  if (lower === 'display local-user' || lower === 'display aaa local-user' || lower === 'show aaa local-user') {
    return { lines: ['Username: netops  State: Active  Service: SSH  Role: network-admin', 'Username: monitor State: Active  Service: SSH  Role: network-operator'] };
  }
  if (lower === 'display alarm' || lower === 'show logging') {
    const alarms = app.sim.alarmsList.filter((a) => a.targetId === dev.id);
    if (!alarms.length) return { lines: ['No active alarms.'] };
    return { lines: alarms.map((a) => `%${a.sev.toUpperCase()} ${a.title} — ${a.desc}`) };
  }

  return { lines: unknown(dev, line) };
}

function linuxCommand(app, dev, lower, line) {
  const ip = mgmtIp(dev, app.state);
  if (lower === 'uname -a') {
    return [`Linux ${hostName(dev, app.state).toLowerCase()} 5.15.0-105-generic #115-Ubuntu SMP x86_64 GNU/Linux`];
  }
  if (lower === 'hostnamectl') {
    return [
      ` Static hostname: ${hostName(dev, app.state).toLowerCase()}`,
      '       Icon name: computer-server',
      '         Chassis: server',
      'Operating System: Ubuntu 22.04.4 LTS',
      '          Kernel: Linux 5.15.0-105-generic',
      `        CPU(s): ${dev.kind === 'server2u' ? 64 : 32}`,
      `      Memory: ${dev.kind === 'server2u' ? '1024Gi' : '256Gi'}`,
      `       Uptime: ${Math.floor(pseudo(dev, 2) * 90) + 3} days`,
    ];
  }
  if (lower === 'uptime') {
    const days = Math.floor(pseudo(dev, 2) * 90) + 3;
    return [` ${now().toTimeString().slice(0, 8)} up ${days} days,  4:21,  2 users,  load average: 0.42, 0.38, 0.35`];
  }
  if (lower === 'cat /etc/os-release') {
    return ['PRETTY_NAME="Ubuntu 22.04.4 LTS"', 'NAME="Ubuntu"', 'VERSION_ID="22.04"', 'VERSION_CODENAME=jammy'];
  }
  if (lower === 'ip a' || lower === 'ip addr') {
    return [
      '1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN',
      '    inet 127.0.0.1/8 scope host lo',
      '2: eth0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc mq state UP group default qlen 1000',
      `    inet ${ip}/24 brd 10.10.${ip.split('.')[2]}.255 scope global eth0`,
      '    link/ether 00:e0:fc:12:34:56 brd ff:ff:ff:ff:ff:ff',
      '3: eth1: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc mq state UP group default qlen 1000',
      '    link/ether 00:e0:fc:12:34:57 brd ff:ff:ff:ff:ff:ff',
    ];
  }
  if (lower === 'ip route') {
    return [
      'default via 10.10.0.1 dev eth0 proto static',
      `10.10.${ip.split('.')[2]}.0/24 dev eth0 proto kernel scope link src ${ip}`,
      '10.0.0.0/24 via 10.10.0.1 dev eth0 proto static',
    ];
  }
  if (lower === 'ss -lntp') {
    return [
      'State  Recv-Q Send-Q Local Address:Port  Peer Address:Port Process',
      'LISTEN 0      128    0.0.0.0:22          0.0.0.0:*         users:(("sshd",pid=812,fd=3))',
      'LISTEN 0      128    0.0.0.0:9100        0.0.0.0:*         users:(("node_exporter",pid=1044,fd=3))',
      dev.kind === 'server2u' ? 'LISTEN 0      128    0.0.0.0:3306        0.0.0.0:*         users:(("mysqld",pid=2210,fd=21))' : 'LISTEN 0      128    0.0.0.0:80          0.0.0.0:*         users:(("nginx",pid=1902,fd=6))',
    ];
  }
  if (lower === 'free -h') {
    const total = dev.kind === 'server2u' ? 1008 : 252;
    const used = Math.round((total * dev.metrics.mem) / 100);
    return [
      '               total        used        free      shared  buff/cache   available',
      `Mem:           ${total}Gi       ${used}Gi      ${Math.round(total * 0.2)}Gi       1.0Gi       ${Math.round(total * 0.3)}Gi       ${total - used}Gi`,
      'Swap:          16Gi       0.0Gi        16Gi',
    ];
  }
  if (lower === 'df -h') {
    return [
      'Filesystem      Size  Used Avail Use% Mounted on',
      '/dev/nvme0n1p2  1.8T  620G  1.1T  37% /',
      '/dev/nvme1n1    3.6T  1.2T  2.2T  36% /data',
      'tmpfs            64G  1.1G   63G   2% /dev/shm',
    ];
  }
  if (lower === 'top -bn1') {
    return [
      'top - 10:24:11 up 12 days,  4:21,  2 users,  load average: 0.42, 0.38, 0.35',
      'Tasks: 412 total,   1 running, 411 sleeping',
      `%Cpu(s): ${Math.round(dev.metrics.cpu * 0.7)}.0 us, ${Math.round(dev.metrics.cpu * 0.2)}.0 sy,  0.0 ni, ${100 - Math.round(dev.metrics.cpu)}.0 id`,
      'MiB Mem : 258000.0 total,  61234.0 free,  82100.0 used, 114666.0 buff/cache',
      '',
      '    PID USER      PR  NI    VIRT    RES    SHR S  %CPU  %MEM     TIME+ COMMAND',
      '   2210 mysql     20   0  18.2g  6.4g  2.1g S  12.3   2.5  921:11.20 mysqld',
      '   1902 root      20   0   2.1g  180m   62m S   1.0   0.1  102:33.11 nginx',
    ];
  }
  if (lower === 'sensors') {
    const rack = app.state.racks.find((r) => r.id === dev.rackId);
    return [
      `Package id 0:  +${Math.round(dev.metrics.temp)}.0°C  (high = +85.0°C, crit = +95.0°C)`,
      `Inlet Temp:     +${((rack?.temp || 22) + 1).toFixed(1)}°C`,
      'Fan1:          8400 RPM',
      'Fan2:          8500 RPM',
    ];
  }
  if (lower === 'ethtool -s eth0') {
    return [
      'NIC statistics:',
      `     rx_bytes: ${(pseudo(dev, 11) * 9e12).toFixed(0)}`,
      `     tx_bytes: ${(pseudo(dev, 12) * 7e12).toFixed(0)}`,
      '     rx_errors: 0',
      '     tx_errors: 0',
      '     rx_crc_errors: 0',
      '     rx_dropped: 12',
    ];
  }
  return [`bash: ${line.split(' ')[0]}: command not found`];
}
