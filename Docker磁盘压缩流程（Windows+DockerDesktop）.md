# Docker 磁盘压缩流程（Windows + Docker Desktop）

本文记录一次已验证可用的流程，用于解决 `docker_data.vhdx` 占用几十 GB 且常规 prune 效果有限的问题。

## 1. 适用场景

- Windows + Docker Desktop（WSL2 后端）
- `docker image/container prune` 后空间仍然很大
- `C:\Users\<用户名>\AppData\Local\Docker\wsl\disk\docker_data.vhdx` 持续膨胀

## 2. 核心原理

- `prune` 只能删除 Docker 内容（镜像/缓存/容器），**不会直接缩小 VHDX 文件体积**。
- 需要在 Docker/WSL 停止后，对 VHDX 做离线压缩，才能真正回收宿主机磁盘空间。

## 3. 操作步骤

### Step A: 查看当前占用

```powershell
docker system df -v
Get-Item "C:\Users\admin\AppData\Local\Docker\wsl\disk\docker_data.vhdx" | Select-Object FullName,@{Name='SizeGB';Expression={[math]::Round($_.Length/1GB,2)}}
```

### Step B: 深度清理 Docker 内容

```powershell
docker builder prune -a -f
docker system prune -a --volumes -f
docker system df -v
```

### Step C: 关闭 Docker 和 WSL

```powershell
# 关闭 Docker Desktop 相关进程（可按需补充）
Get-Process -Name "Docker Desktop","com.docker.backend","com.docker.proxy" -ErrorAction SilentlyContinue | Stop-Process -Force

# 关闭 WSL
wsl --shutdown
```

### Step D: 压缩 VHDX

创建 `diskpart` 脚本并执行：

```powershell
$vhd = "C:\Users\admin\AppData\Local\Docker\wsl\disk\docker_data.vhdx"
$dp  = "C:\VM-workshop\code\tmp\diskpart_compact_docker.txt"

$content = @"
select vdisk file="$vhd"
attach vdisk readonly
compact vdisk
detach vdisk
"@

Set-Content -Path $dp -Value $content -Encoding ASCII
diskpart /s $dp
```

### Step E: 验证压缩结果

```powershell
Get-Item "C:\Users\admin\AppData\Local\Docker\wsl\disk\docker_data.vhdx" | Select-Object FullName,@{Name='SizeGB';Expression={[math]::Round($_.Length/1GB,2)}}
```

### Step F: 重启 Docker Desktop 并检查可用性

```powershell
Start-Process "C:\Program Files\Docker\Docker\Docker Desktop.exe"
docker info --format "{{.ServerVersion}}"
```

## 4. 本次执行结果（示例）

- 压缩前：`58.76 GB`
- 压缩后：`3.39 GB`
- 释放空间约：`55 GB`

## 5. 常见问题

### Q1: `Hyper-V` 模块不可用，`Optimize-VHD` 失败怎么办？

可直接使用上文 `diskpart compact vdisk` 方案，不依赖 Hyper-V PowerShell 模块。

### Q2: `diskpart` 看起来没输出？

常见于脚本格式或权限问题。重点确认：
- `diskpart` 脚本必须是多行
- 先 `wsl --shutdown`
- Docker Desktop 进程已停止

### Q3: 如何减少后续膨胀？

- 定期执行：
  - `docker builder prune -a -f`
  - `docker system prune -a --volumes -f`
- 构建频繁时，建议按周期做一次离线压缩。

