# 第三方组件与许可

## NetDevOps-Toolbox-V1

- 项目地址：<https://github.com/lovekeven/NetDevOps-Toolbox-V1>
- 许可证：MIT
- 本项目使用方式：
  - `src/netdevops/templates.js` 中的多厂商命令模板，改编自该项目的 `config/command_templates.json`（分类与命令保留，补充了 Linux 设备类别）；
  - Web SSH 终端、健康检查、AI 分析的产品形态参考了该项目的对应模块，代码为基于本机房仿真数据的重新实现（不包含其 Python 后端、SNMP/SSH 采集、Nornir、邮件与云端对接）。

```
MIT License

Copyright (c) 2026 lovekeven

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## three.js

- 版本：r187（已本地化到 `vendor/three/`）
- 许可证：MIT — <https://github.com/mrdoob/three.js>

## DCIM 3D 建模包（项目所有者提供）

- 来源：用户提供的 `datacenter-3d` 源码包（程序化建模，无外部模型/贴图素材）。
- 使用部分：`src/paneltex.js` 中的设备面板贴图生成逻辑；`src/roompack.js` 中的机房基础设施构建器（吊顶、配电、消防、NOC、入口、货架、端门、粒子）；第一人称巡检的交互形态参考。
- 许可：该源包未附 LICENSE 文件，经项目所有者授权在本项目中融合使用。
