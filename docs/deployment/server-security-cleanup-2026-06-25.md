# 服务器安全清理记录（110.40.229.145）

## 基本信息

- 目标主机：`110.40.229.145`
- 系统：Ubuntu
- 排查日期：`2026-06-25`
- 目标：定位高 CPU 挖矿进程、梳理自动重启链路、清理隐藏入口与持久化

## 结论摘要

这台机器上曾经存在一条明确的恶意投放与持久化链，包含启动脚本、`LD_PRELOAD` 劫持、伪装二进制、`systemd`/`SysV` 入口和矿工进程本体。相关恶意文件与进程已清理。

另外，腾讯云确实有 `TAT`，官方客户端名称是 `tat_agent`。当前机器上的 `tat_agent.service` 可以对应腾讯云官方自动化工具，不应直接当作后门；`tat_install.service` 目前未在公开资料里直接确认同名标准项，暂按本机安装/封装服务看待。

## 已确认的异常链路

### 1. 挖矿进程本体

- 进程 PID：`2413585`
- 用户：`root`
- 进程名：`kworkelr`
- 运行命令：`llda`
- 原始路径：`/tmp/.gpg-l4snjzqxfe/kworkelr`（已删除）
- 外联地址：`142.248.80.25:10020`

这条进程链是本次排查中最明确的恶意载荷。

## 二次复查补充

第二轮现场复查时，又抓到一条更完整的启动链：

- `systemctl status 2569591` 显示它属于 `session-183374.scope`
- 会话来源是 `sshd`
- 远端地址是 `121.11.207.229`
- 会话里还挂着两个 `./kw0rker` 进程和一个 `llda` 进程

对应的 `journalctl` 记录显示，`2026-06-14 05:10:03` 左右出现了以下动作：

- `useradd admin`
- 写入 `/usr/bin/lookme`
- 将 `/usr/bin/lookme` 设为可执行
- 执行 `nohup /usr/bin/lookme`

这说明早期入口是一次 SSH 会话内的手工投放和拉起，而不是腾讯云 `TAT` 本身。

### 2. 持久化与自动重启入口

以下路径属于已确认或高度可疑的持久化层，已处理或已清理：

- `/etc/profile.d/bash.cfg`
- `/etc/profile.d/bash.cfg.sh`
- `/etc/profile.d/gateway.sh`
- `/etc/init.d/dns-udp4`
- `/etc/rc.d/dns-udp4`
- `/etc/rc2.d/S01dns-udp4`
- `/etc/rc3.d/S01dns-udp4`
- `/etc/rc4.d/S01dns-udp4`
- `/etc/rc5.d/S01dns-udp4`
- `/etc/rc.local`
- `/boot/system.pub`
- `/usr/sbin/netstat.cfg`
- `/usr/lib/system.mark`
- `/.mod`
- `/go/cx`
- `/etc/crontab.bak`

### 3. `LD_PRELOAD` / rootkit 层

- `/etc/ld.so.preload`
- `/$LIB/libonion.so`
- `/usr/lib/x86_64-linux-gnu/libonion_security.so.1.0.19`
- `/lib/x86_64-linux-gnu/libonion.so`
- `/usr/lib/x86_64-linux-gnu/libonion.so`

这层会影响动态链接加载，是本次发现的重点隐藏入口之一。

## 历史持久化根因

在取证备份里，还找到了更早期的落地与自启动配置：

### systemd 服务

- 文件：`6w7g7cynb3.service`
- 内容摘要：
  - `ExecStart=/go/cx 3000`
  - `Restart=always`
  - `User=root`
  - `WantedBy=multi-user.target`

### cron 计划任务

- `/etc/crontab` 里曾包含：
  - `*/1 * * * * root /.mod`

这两项解释了为什么这条链会持续复活，以及为什么清理后如果只删文件不杀进程，CPU 还会再次抬起来。

### 4. 伪装与辅助文件

- `/usr/bin/aaa`
- `/usr/bin/aa0`
- `/var/lib/systemd/.kworkerd`
- `/go/ali.txt`

这些文件均已删除。

## 已完成的清理动作

- 杀掉了矿工进程 `2413585`
- 在二次复查中又杀掉了残留的 `kw0rker` / `llda` 进程
- 删除了上面列出的恶意脚本、服务文件和投放文件
- 清理了 `/etc/ld.so.preload` 及其对应的恶意库
- 删除了伪装二进制 `aaa`、`aa0`
- 将 `/etc/rc.local` 重写为最小安全版本

当前 `/etc/rc.local` 内容为：

```bash
#!/bin/bash
exit 0
```

## 验证结果

清理后做过的核验结果如下：

- `ps` 中已不再看到 `2413585`
- `ps` 中也不再看到 `kw0rker` 或 `llda`
- `/proc/*/maps` 中未再发现 `libonion` 映射
- 相关恶意文件路径均已不存在
- 系统中未再看到之前那条矿工进程的自动拉起迹象
- `admin` 用户已不在系统中
- 当前 `/etc/crontab` 已恢复为默认内容，未见 `/.mod`

## 仍需注意的项

### 1. 腾讯云 TAT

腾讯云官方确实存在 TAT，官方客户端名称是 `tat_agent`。官方资料能对应上 `tat_agent.service` 和安装脚本目录结构，因此它本身不应默认视为恶意。

参考资料：

- `https://cloud.tencent.com/product/tat`
- `https://intl.cloud.tencent.com/document/product/1147/54056`
- `https://github.com/Tencent/tat-agent`

### 2. SSH 安全配置

当前机器的 SSH 配置里仍然保留了较宽松的选项：

- `PermitRootLogin yes`
- `PasswordAuthentication yes`

这不一定是后门，但安全风险较高。若后续业务允许，建议改成：

- 禁用 root 直接登录
- 仅保留密钥登录
- 轮换 SSH 密码和密钥

### 3. 其他服务核查

`tat_install.service`、`tat_agent.service` 和 `/etc/udev/rules.d/80-max-sectors-blk.rules` 目前没有被判定为恶意，但建议在确认业务需要后再决定是否保留。

## 后续建议

1. 轮换这台机器的 SSH 密码和所有可用密钥
2. 检查同账号、同 VPC 或同镜像下的其他主机是否有相同 IOC
3. 对机器做一次快照或离线备份，便于后续取证
4. 如果不需要腾讯云 TAT，再单独评估是否卸载或禁用
5. 持续观察 CPU、网络连接和定时任务是否出现异常回归

## 备注

本记录基于 2026-06-25 当天的现场排查结果，结论以当时的文件、进程和服务状态为准。
