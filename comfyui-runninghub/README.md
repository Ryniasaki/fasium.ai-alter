## ComfyUI Runninghub FastAPI 微服务

基于 FastAPI 的微服务，与 Runninghub 交互完成上传、创建任务、轮询与获取结果，支持可选的 OpenRouter 翻译。

### 运行步骤
1) 复制 `.env.example` 为 `.env` 并修改值。
2) 安装依赖并启动：

```bash
python -m venv .venv
.venv\\Scripts\\pip install fastapi uvicorn[standard] httpx python-multipart tenacity pydantic-settings
.venv\\Scripts\\uvicorn app.main:app --reload --host 0.0.0.0 --port 8080
```

若使用 Poetry：

```bash
poetry install
poetry run uvicorn app.main:app --reload --host 0.0.0.0 --port 8080
```

### 环境变量
见 `.env.example`：
```
RUNNINGHUB_API_KEY=
RUNNINGHUB_HOST=https://www.runninghub.cn
OPENROUTER_API_KEY=
OPENROUTER_MODEL=google/gemini-1.5-flash
REQUEST_TIMEOUT_SECONDS=60
POLL_INTERVAL_SECONDS=8
MAX_POLL_SECONDS=300
```

### 主要 API
- POST `/v1/upload` 表单上传：`file`, `fileType`
- POST `/v1/generate` JSON：`webappId` 或 `workflowId`, `nodeInfoList`, `translate_prompt`
- POST `/v1/super_resolution` 表单：`file`, 可选 `fileType`，触发超级分辨率工作流
- POST `/v1/svg_vectorization` 表单：`file`, 可选 `fileType`，触发矢量化工作流
- GET `/v1/tasks/{task_id}`
- GET `/v1/tasks/{task_id}/outputs`


