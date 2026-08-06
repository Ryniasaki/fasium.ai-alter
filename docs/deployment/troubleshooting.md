# 常见问题排查

## 服务启动失败

### 端口被占用

**现象：** `Address already in use`

**排查：**

```bash
# Linux
lsof -i:8080   # 查看占用 8080 端口的进程
lsof -i:8081
lsof -i:3000

# Windows
netstat -ano | findstr :8080
```

**解决：** 终止占用进程或使用 `./start_fashion_ai.sh restart` 自动清理。

### Python 依赖缺失

**现象：** `ModuleNotFoundError`

**解决：**

```bash
source .venv/bin/activate
pip install -r requirements.txt
```

### 虚拟环境未创建

**现象：** `.venv/bin/activate: No such file or directory`

**解决：**

```bash
python3 -m venv .venv
```

---

## 跨服务通信失败

### Tenant Service 无法连接 RunningHub

**现象：** HTTP 502 错误

**排查：**
1. 确认 RunningHub 已启动：`curl http://localhost:8080/health`
2. 检查 Tenant Service `.env` 中 `RUNNINGHUB_SERVICE_URL` 配置
3. 查看 Tenant Service 日志中的错误详情

### 前端无法连接 Tenant Service

**现象：** 页面报 Network Error 或 CORS 错误

**排查：**
1. 确认 Tenant Service 已启动：`curl http://localhost:8081/docs`
2. 检查前端 `.env` 中 `NEXT_PUBLIC_TENANT_API_URL` 配置
3. 若出现 CORS 错误，确认 Tenant Service `main.py` 中 `allow_origins` 包含前端域名

---

## 任务状态异常

### 任务卡在 RUNNING 状态

**可能原因：**
- Runninghub.cn 处理超时
- 网络连接中断

**排查：**
1. 检查 `MAX_POLL_SECONDS` 配置（默认 300 秒）
2. 查看 RunningHub 日志中的轮询记录
3. 在 Runninghub.cn 控制台查看任务状态

### 任务状态为 FAILED

**排查：**
1. 查看 RunningHub 日志中的错误信息
2. 检查输入图片是否符合要求（格式、大小）
3. 检查提示词是否为空
4. 确认 `RUNNINGHUB_API_KEY` 有效且有余额

---

## 图片无法加载

### 生成结果图片 404

**排查：**
1. 确认 `output/` 目录下文件存在
2. 检查文件权限（Linux 下需要读取权限）
3. 确认访问路径正确：`/api/proxy/static/images/{username}/{taskId}/image_0.png`

### 图片加载缓慢

**可能原因：**
- 生成的图片过大
- 网络带宽不足

**建议：** 使用 Nginx 反向代理并开启静态文件缓存。

---

## 数据库问题

### SQLite 锁定

**现象：** `database is locked`

**原因：** SQLite 不支持高并发写入。

**解决：** 生产环境切换至 MySQL 存储模式。

### MySQL 连接失败

**排查：**
1. 确认 MySQL 服务已启动
2. 检查 `.env` 中 `MYSQL_HOST`、`MYSQL_PORT`、`MYSQL_USER`、`MYSQL_PASSWORD` 配置
3. 确认数据库 `comfyui_tenant_service` 已创建
4. 确认用户有读写权限

### JSON 存储数据损坏

**现象：** `json.decoder.JSONDecodeError`

**排查：**
1. 检查 `database/` 目录下对应 JSON 文件格式是否正确
2. 从备份恢复或清空文件内容为 `[]` 或 `{}`

---

## 认证问题

### Token 过期

**现象：** 401 Unauthorized

**解决：** 重新登录获取新 Token。Token 默认有效期 7 天。

### 登录失败

**排查：**
1. 确认用户名和密码正确
2. 查看 Tenant Service 认证日志
3. 确认用户 `is_active` 为 true

---

## 日志查看

各服务的日志位置：

| 服务 | 日志路径 |
|------|----------|
| Tenant Service | `comfyui-tenant-service/logs/` |
| RunningHub | `comfyui-runninghub/logs/` |
| 前端 (生产) | `comfyui-clothing/output.log` |
| Uvicorn | 各服务目录下 `uvicorn.log` |

```bash
# 实时查看日志
tail -f comfyui-tenant-service/logs/main.log
```
