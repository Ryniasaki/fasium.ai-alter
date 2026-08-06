# API 架构说明

## 概述

本项目采用了正确的生产环境架构，前端不直接请求后端API，而是通过Next.js API路由进行代理。

## 架构图

```
用户浏览器 → Next.js前端(3000) → Next.js API路由 → Tenant Service(8081) → RunningHub Service(8080)
```

## API路由映射

### 认证相关
- `POST /api/auth/login` → `POST http://localhost:8081/auth/token`
- `POST /api/auth/register` → `POST http://localhost:8081/auth/register`
- `GET /api/auth/me` → `GET http://localhost:8081/auth/me`

### 租户相关
- `GET /api/tenants/me` → `GET http://localhost:8081/tenants/me`

### Redesign相关
- `POST /api/proxy/upload` → `POST http://localhost:8081/proxy/upload`
- `POST /api/proxy/complete_image_edit` → `POST http://localhost:8081/proxy/complete_image_edit`
- `GET /api/proxy/tasks/[taskId]` → `GET http://localhost:8081/proxy/tasks/[taskId]`
- `POST /api/proxy/tasks/[taskId]/complete` → `POST http://localhost:8081/proxy/tasks/[taskId]/complete`
- `GET /api/proxy/tasks/history` → `GET http://localhost:8081/proxy/tasks/history`
- `GET /api/proxy/static/images/[...path]` → `GET http://localhost:8081/proxy/static/images/[...path]`

## 优势

1. **安全性**: 前端不直接暴露后端API地址
2. **可扩展性**: 可以在API路由中添加额外的验证、日志记录等
3. **生产就绪**: 适合部署到生产环境
4. **统一管理**: 所有API请求都通过Next.js统一管理

## 环境变量

```bash
# .env.local
NEXT_PUBLIC_TENANT_API_URL=http://localhost:8081
```

## 开发流程

1. 前端发起请求到 `/api/auth/login`
2. Next.js API路由接收请求
3. API路由转发请求到 `http://localhost:8081/auth/token`
4. Tenant Service处理请求并返回响应
5. API路由将响应返回给前端

## 部署注意事项

在生产环境中，需要确保：
1. `NEXT_PUBLIC_TENANT_API_URL` 指向正确的tenant service地址
2. 网络配置允许Next.js服务器访问tenant service
3. 考虑添加CORS、速率限制等安全措施
