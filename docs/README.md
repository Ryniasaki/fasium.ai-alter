# Fasium 项目文档

Fasium 是一款面向服装设计与商品企划的 AI 设计平台，将灵感生成、改款、试穿展示、资料整理等步骤集成到同一个工具中。

## 技术栈一览

| 层级 | 服务 | 技术栈 | 端口 |
|------|------|--------|------|
| 前端 | comfyui-clothing | Next.js 14 / React 19 / TypeScript / Tailwind CSS | 3000 |
| 中间层 | comfyui-tenant-service | FastAPI / Python / SQLAlchemy / JWT | 8081 |
| 工作流引擎 | comfyui-runninghub | FastAPI / Python / Runninghub.cn API | 8080 |

## 仓库结构

```
code/
├── comfyui-clothing/           # Next.js 前端应用
├── comfyui-tenant-service/     # 多租户中间层服务
├── comfyui-runninghub/         # 工作流执行引擎
├── comfyui-product-docs/       # 产品资料（设计稿、会议记录）
├── docs/                       # 项目文档（本目录）
├── start_fashion_ai.sh         # Linux 一键启停脚本
└── start-backend-services.bat  # Windows 后端启动脚本
```

## 文档导航

### 系统架构
- [系统总览与技术栈](architecture/overview.md)
- [服务间通信与数据流](architecture/service-communication.md)
- [数据模型与存储方案](architecture/data-model.md)
- [工作流引擎架构](architecture/workflow-engine.md)

### 开发指南
- [环境搭建与快速启动](development/getting-started.md)
- [前端开发规范](development/frontend-guide.md)
- [后端开发规范](development/backend-guide.md)
- [新增工作流指南](development/adding-workflow.md)
- [代码规范与约定](development/coding-conventions.md)
- [Seedance 2.0 调用指南](development/seedance2-call-guide.md)

### API 参考
- [租户服务 API](api/tenant-service-api.md)
- [工作流服务 API](api/runninghub-api.md)
- [前端 API 路由映射](api/frontend-api-routes.md)

### 部署与运维
- [部署指南](deployment/deployment-guide.md)
- [环境变量参考](deployment/environment-variables.md)
- [常见问题排查](deployment/troubleshooting.md)
- [服务器安全清理记录](deployment/server-security-cleanup-2026-06-25.md)

### 产品文档
- [功能总览](product/feature-overview.md)
- [用户使用指南](product/user-guide.md)
- [常见问答](product/faq.md)

## 快速链接

- **快速启动** → [getting-started.md](development/getting-started.md)
- **API 文档** → [tenant-service-api.md](api/tenant-service-api.md)
- **部署上线** → [deployment-guide.md](deployment/deployment-guide.md)
