# API 集成测试说明

## 概述

现在 `comfyui-clothing` 已经集成了真实的 API 调用，不再使用模拟数据。登录和注册功能会真正调用 `comfyui-tenant-service` 的 API。

## 配置要求

### 1. 环境变量配置

创建 `.env.local` 文件：
```bash
cp .env.local.example .env.local
```

编辑 `.env.local` 文件：
```bash
# ComfyUI Tenant Service API URL
NEXT_PUBLIC_TENANT_API_URL=http://localhost:8081
```

### 2. 启动后端服务

确保 `comfyui-tenant-service` 正在运行：
```bash
cd comfyui-tenant-service
# 使用 JSON 存储（默认）
STORAGE_TYPE=json
python -m uvicorn app.main:app --reload --port 8081
```

## 测试步骤

### 1. 启动前端服务
```bash
cd comfyui-clothing
npm run dev
```

### 2. 测试注册功能

1. 访问 `http://localhost:3000`
2. 点击任意登录按钮
3. 在登录弹窗中点击"立即注册"
4. 填写注册信息：
   - 用户名：任意（如 `testuser`）
   - 密码：至少6位
   - 确认密码：与密码一致
5. 点击"立即注册"

**预期结果：**
- 注册成功后会显示成功提示
- 自动跳转到登录页面
- 用户信息会保存到 `comfyui-tenant-service` 的 JSON 存储中

### 3. 测试登录功能

1. 在登录弹窗中输入刚才注册的用户名和密码
2. 点击"登录"

**预期结果：**
- 登录成功后会跳转到 `/dashboard`
- 用户状态会保存到 localStorage
- 页面刷新后用户状态会保持

### 4. 验证 API 调用

在浏览器开发者工具的 Network 标签中，你应该能看到：

**注册请求：**
```
POST http://localhost:8081/auth/register
Content-Type: application/json
Body: {"username": "testuser", "password": "password123", "tenant_id": 1}
```

**登录请求：**
```
POST http://localhost:8081/auth/token
Content-Type: application/x-www-form-urlencoded
Body: username=testuser&password=password123
```

**获取租户信息请求：**
```
GET http://localhost:8081/tenants/me
Authorization: Bearer <token>
```

## 数据存储验证

### JSON 存储模式
检查 `comfyui-tenant-service/database/` 目录下的文件：
- `users.json` - 应该包含注册的用户信息
- `tenants.json` - 应该包含租户信息

### 数据库存储模式
如果使用 MySQL 或 SQLite，检查相应的数据库表：
- `users` 表 - 用户信息
- `tenants` 表 - 租户信息

## 故障排除

### 1. CORS 错误
如果遇到 CORS 错误，确保 `comfyui-tenant-service` 的 CORS 配置正确。

### 2. 网络连接错误
- 确保 `comfyui-tenant-service` 正在运行在 `http://localhost:8081`
- 检查 `.env.local` 中的 `NEXT_PUBLIC_TENANT_API_URL` 配置

### 3. 认证错误
- 检查 `comfyui-tenant-service` 的日志输出
- 确保 JWT 配置正确

### 4. 存储错误
- 检查 `comfyui-tenant-service` 的存储配置
- 确保有写入权限

## 功能特性

### ✅ 已实现的功能
- 真实的 API 调用
- 用户认证状态管理
- 自动登录状态恢复
- 错误处理和用户反馈
- 响应式设计

### 🔄 数据流
```
comfyui-clothing (前端)
    ↓ HTTP 请求
comfyui-tenant-service (多租户中间层)
    ↓ 代理请求
comfyui-runninghub (后端服务)
    ↓ API 调用
Runninghub API
```

### 📱 用户体验
- 登录状态持久化
- 自动跳转到工作台
- 错误提示和加载状态
- 响应式设计

现在登录和注册功能已经真正集成了 API 调用！🎉
