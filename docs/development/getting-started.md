# 环境搭建与快速启动

## 前置依赖

| 工具 | 版本要求 | 用途 |
|------|----------|------|
| Node.js | >= 18 | 前端运行时 |
| pnpm | >= 8 | 前端包管理 |
| Python | >= 3.10 | 后端运行时 |
| pip | 最新 | Python 包管理 |

## 1. 克隆仓库

```bash
git clone <repo-url>
cd code
```

## 2. 启动 RunningHub Service（端口 8080）

```bash
cd comfyui-runninghub

# 创建虚拟环境
python -m venv .venv

# 激活虚拟环境
# Windows:
.venv\Scripts\activate
# Linux/Mac:
source .venv/bin/activate

# 安装依赖
pip install -r requirements.txt

# 配置环境变量
cp .env.example .env
# 编辑 .env，填入 RUNNINGHUB_API_KEY

# 启动
uvicorn app.main:app --host 0.0.0.0 --port 8080
```

## 3. 启动 Tenant Service（端口 8081）

```bash
cd comfyui-tenant-service

# 创建虚拟环境
python -m venv .venv

# 激活虚拟环境
# Windows:
.venv\Scripts\activate
# Linux/Mac:
source .venv/bin/activate

# 安装依赖
pip install -r requirements.txt

# 配置环境变量
cp .env.example .env
# 编辑 .env，配置 SECRET_KEY、STORAGE_TYPE 等

# 启动
uvicorn app.main:app --host 0.0.0.0 --port 8081
```

## 4. 启动前端（端口 3000）

```bash
cd comfyui-clothing

# 安装依赖
pnpm install

# 配置环境变量
cp .env.local.example .env.local
# 确认 NEXT_PUBLIC_TENANT_API_URL=http://localhost:8081

# 开发模式启动
pnpm dev
```

## 一键启动脚本

### Windows

```bash
# 启动两个后端服务
start-backend-services.bat

# 前端需单独启动
cd comfyui-clothing && pnpm dev
```

### Linux（生产模式）

```bash
# 启动/停止/重启/状态查看
./start_fashion_ai.sh start
./start_fashion_ai.sh stop
./start_fashion_ai.sh restart
./start_fashion_ai.sh status
```

该脚本会依次启动 RunningHub (8080)、Tenant Service (8081)、前端构建并启动 (3000)。

## 开发模式配置

在前端 `.env.local` 中设置：

```bash
NEXT_PUBLIC_DEV_MODE=true  # 跳过登录认证，方便本地开发
```

## 验证服务是否正常

| 服务 | 验证方式 |
|------|----------|
| RunningHub | 访问 `http://localhost:8080/health` 返回 `{"status": "healthy"}` |
| Tenant Service | 访问 `http://localhost:8081/docs` 查看 Swagger 文档 |
| 前端 | 访问 `http://localhost:3000` 看到登录页面 |

## 存储模式选择

开发环境推荐使用默认的 JSON 存储（无需数据库）。如需切换：

```bash
# .env
STORAGE_TYPE=json     # 默认，文件存储
STORAGE_TYPE=sqlite   # SQLite 单文件数据库
STORAGE_TYPE=mysql    # MySQL 数据库
```

详见 [环境变量参考](../deployment/environment-variables.md)。
