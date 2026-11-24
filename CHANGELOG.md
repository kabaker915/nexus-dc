# Changelog

## 1.3.0 — 2026-11-25

### 新增
- **第一人称巡检**（`P`）：WASD/方向键移动、Shift 加速、拖拽环视、准星拾取设备、机柜碰撞、随身头灯，退出恢复原机位。
- **设备面板贴图升级**：融合 DCIM 3D 建模包的程序化面板库，1U/2U/4U 服务器、交换机、防火墙、配线架、PDU 具备硬盘托架、端口矩阵、品牌/型号、状态灯与噪点细节。
- 新增 `tools/walk-scenario.js` 巡检回归脚本。

### 兼容
- 端口拾取、布线、机柜正面编辑、批量操作、2D 与 NetDevOps 全部回归通过。

## 1.2.0 — 2026-11-24

### 性能
- 静态阴影冻结：`shadowMap.autoUpdate = false`，仅在设备/机柜变化、开关门动画时重绘。
- 按需渲染：交互时 60 fps，空闲降到 12 fps，标签页隐藏时暂停；2D 绘制节流到 20 fps。
- UI 增量刷新：机柜列表按布局版本重建（5 s 兜底），检查器 2 s 节流，告警徽章口径统一。
- 静态资源 gzip + ETag/304，`vendor/` 长缓存。

### 安全
- 本地网关新增 `X-Nexus-Token` 校验（页面自动注入），并校验 `Host` / `Origin`，阻断 DNS rebinding。
- Webhook 默认只允许 https + 公网地址，可显式放开内网/HTTP；禁止跟随重定向。
- Redfish 密码仅保存在内存，不落盘；SNMP community 可配置。

### 文档
- 新增 **完整使用说明书** [`MANUAL.md`](MANUAL.md)。
- README 首屏加入说明书入口与运行优化说明。
- 新增 CI 工作流模板 [`docs/ci-workflow.yml`](docs/ci-workflow.yml)：语法检查 + 解析测试 + 网关/安全/缓存测试（启用方式见 README）。

## 1.1.0 — 2026-11

- 3D/2D 数字孪生、端口级布线、NetDevOps 工具箱、真实设备接入（SSH / SNMP / Redfish / LLDP）。
- 撤销重做、多选批量、42U 正面编辑、机柜模板、布线助手。
- 全局端口实例池、线缆合批、LED 分帧。
- 工单、演练剧本、热力/体积光、容量预测、PDF 报告。
- GitHub Pages 在线演示与 MIT 许可。
