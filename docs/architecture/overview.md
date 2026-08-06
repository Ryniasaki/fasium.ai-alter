# 系统总览与技术栈

## 架构概览

Fasium 采用三层微服务架构，通过 API 代理链路实现前后端分离和多租户隔离：

```
浏览器
  ↓ HTTP
Next.js 前端 (port 3000)
  ↓ Next.js API Routes（代理层）
Tenant Service (port 8081)       ← 认证、租户隔离、任务管理、计费
  ↓ HTTP
RunningHub Service (port 8080)   ← 工作流编排、文件上传
  ↓ HTTP
Runninghub.cn 云端               ← ComfyUI 节点执行
```

## 各服务职责

### comfyui-clothing（前端）

| 项目 | 说明 |
|------|------|
| 框架 | Next.js 14.2.16 (App Router) |
| 语言 | TypeScript |
| UI | React 19 + shadcn/ui (Radix UI) + Tailwind CSS 3.4 |
| 状态 | React Context API（auth-context、i18n-context） |
| 动画 | Framer Motion |
| 表单 | React Hook Form + Zod |

**核心职责：**
- 提供用户界面（25+ 页面）
- 通过 Next.js API Routes 代理所有后端请求
- 浏览器端图片合成（覆盖层 + 底图合并）
- JWT Token 管理（localStorage 存储）
- 国际化支持（中文/英文）

### comfyui-tenant-service（多租户中间层）

| 项目 | 说明 |
|------|------|
| 框架 | FastAPI 0.115.0 |
| 语言 | Python 3.x |
| 数据库 | JSON / SQLite / MySQL（可切换） |
| ORM | SQLAlchemy 2.0.25 |
| 认证 | JWT (python-jose) + bcrypt |

**核心职责：**
- 用户注册/登录与 JWT 认证
- 多租户数据隔离
- 任务记录管理（创建、轮询、完成、历史）
- 代理请求至 RunningHub 并存储生成结果
- 计费与积分管理
- 项目与团队协作
- LoRA 模型管理
- 后台任务（任务监控、存储清理、数据库备份、报告转换）

### comfyui-runninghub（工作流引擎）

| 项目 | 说明 |
|------|------|
| 框架 | FastAPI 0.115.0 |
| 语言 | Python 3.x |
| 核心依赖 | httpx、tenacity（重试）、pydantic-settings |

**核心职责：**
- 工作流注册与动态端点生成
- 文件上传至 Runninghub.cn
- 构建 ComfyUI 节点配置（node_info_list）
- 任务提交与状态轮询
- 无状态设计，不持有数据库

## 端口与地址约定

| 服务 | 开发端口 | 生产域名 |
|------|----------|----------|
| 前端 | `http://localhost:3000` | `https://fasium.cn` / `https://fasium.ai` |
| Tenant Service | `http://localhost:8081` | 同服务器内部访问 |
| RunningHub | `http://localhost:8080` | 同服务器内部访问 |
| Runninghub.cn | — | `https://www.runninghub.cn` |

## 认证体系

```
1. 用户通过 POST /auth/token 提交用户名和密码
2. Tenant Service 验证后返回 JWT access_token
3. 前端将 token 存入 localStorage
4. 后续请求在 Authorization header 中携带 Bearer token
5. Next.js API Route 透传 header 至 Tenant Service
6. Tenant Service 解析 token，提取 username 和 tenant_id
7. 请求转发至 RunningHub 时不携带原始 token
```

Token 有效期默认 7 天（10080 分钟），算法为 HS256。

## CORS 配置

两个后端服务均允许以下来源：
- `http://localhost:8080`
- `http://127.0.0.1:8080`
- `https://fashion.jototech.cn`
- `https://fasium.cn`
- `https://fasium.ai`
