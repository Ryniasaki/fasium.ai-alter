# 本地联调问题记录（2026-04-21）

本文记录这次本地联调和线上切换过程中实际遇到的问题、定位过程和处理结果，方便后续排查时快速回看。

## 1. `/api/analytics/usage` 上报 502，tenant service 超时

### 现象

- 前端 `pnpm run dev` 时，浏览器或 Next 日志里出现：
  - `usage analytics tenant forward failed: TypeError: fetch failed`
  - `HeadersTimeoutError: Headers Timeout Error`
- 同时 tenant service 的其他请求也变慢，例如：
  - `GET /api/proxy/projects/{projectId}/tasks` 需要几分钟才返回

### 定位结果

- 前端埋点路由会先写本地日志，再同步转发到 tenant service。
- 转发目标是 `http://localhost:8081/analytics/usage`。
- tenant service 在 `app/routers/analytics.py` 中处理该请求时，`UsageDailyStat.first_seen_at` / `last_seen_at` 可能从 SQLite 读出为 naive datetime。
- 代码原本把它们和 UTC aware 的 `event_at_utc` 直接比较，触发异常：
  - `TypeError: can't compare offset-naive and offset-aware datetimes`

### 处理结果

- 已在 [`comfyui-tenant-service/app/routers/analytics.py`](../../comfyui-tenant-service/app/routers/analytics.py) 中增加 datetime 归一化：
  - SQLite/DB 读出的时间统一转为 UTC aware 后再比较

### 说明

- 这个问题本质上是一个确定的代码 bug，不是前端埋点本身的问题。
- 但由于 tenant service 当前是单进程 `uvicorn --reload` 方式运行，单个慢请求会把后续请求一起拖慢，所以表面症状会放大。

## 2. tenant service 健康检查、`/docs`、`/metrics` 一度整体超时

### 现象

- `http://127.0.0.1:8081/health`
- `http://127.0.0.1:8081/ready`
- `http://127.0.0.1:8081/docs`
- `http://127.0.0.1:8081/metrics`

上述接口都出现了明显超时，而不是正常返回。

### 定位结果

- `tenant-service` 进程确实在监听 `8081`。
- SQLite 本身没有表现出写锁卡死：
  - `BEGIN IMMEDIATE` 秒级通过
  - `users` / `tenants` / `billing_usage` 查询都很快
- 因此更像是：
  - 某个慢请求把事件循环卡住
  - 或者单进程异步服务被同步数据库/文件操作拖慢

### 处理建议

- 优先修复具体异常请求，例如上面的 analytics 时间比较 bug。
- 如果后续仍然有整体超时：
  - 考虑 tenant service 改成多 worker
  - 降低高频同步转发
  - 把埋点上报改为更宽松的失败降级

## 3. `/api/admin/broadcasts` 404

### 现象

- 登录后访问 `GET /api/admin/broadcasts` 仍然返回 `404 Not Found`。

### 定位结果

- 前端路由存在。
- 404 实际来自 tenant service。
- 原因是线上运行中的 tenant-service 镜像版本偏旧，缺少 `admin/broadcasts` 这条后端路由。

### 处理结果

- 已重新构建并发布 tenant-service 镜像。
- 重建后该接口恢复正常返回。

## 4. 本地 SQLite 计费开关默认关闭

### 现象

- 本地 `/admin` 页面里，计费模式默认显示关闭。

### 定位结果

- 计费开关不是写在 `.env` 的长期配置里，而是存储在默认租户的 `tenant.settings.billing.enabled` 中。
- 本地 SQLite 数据库里，默认租户一开始是：
  - `{"billing": {"enabled": false}}`

### 处理结果

- 已直接修改本地 SQLite 中 `tenants.id = 1` 的 settings 为：
  - `{"billing": {"enabled": true}}`

### 说明

- `.env` 里的 `STORAGE_TYPE=sqlite` 只是说明当前本地使用 SQLite。
- 计费是否开启，仍然以数据库里租户设置为准。

## 5. 前端 `/admin` 页面的计费开关不可点击

### 现象

- 在本地 `pnpm run dev` 下，管理员页面的计费开关看起来是灰的，无法点击。

### 定位结果

- 页面代码里开关被写成了：
  - `disabled={billingSettingsLoading || !token}`
- 所以只要以下任一条件成立，它就会不可点击：
  - `token` 为空
  - `billingSettingsLoading` 还在进行中

### 说明

- 这不是数据库本身的问题。
- 本质上是前端对认证状态和加载状态的保护逻辑。

## 已确认的修复

- `analytics.py` 的 naive / aware datetime 比较问题已修复。
- tenant-service 的 `admin/broadcasts` 镜像版本问题已通过重建镜像解决。
- 本地 SQLite 默认租户计费已手动改为开启。

## 后续建议

1. 重启本地 tenant service，再复测 `/api/analytics/usage`。
2. 如果还出现长时间超时，再继续拆分 tenant service 的慢请求路径。
3. 需要正式压测时，优先避免同步转发式埋点影响主业务链路。
