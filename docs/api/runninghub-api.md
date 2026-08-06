# 工作流服务 API 文档

**Base URL:** `http://localhost:8080`
**Swagger 文档:** `http://localhost:8080/docs`
**认证方式:** 无（由上游 Tenant Service 负责认证）

---

## 健康检查

### GET /health

**响应:**

```json
{
  "status": "healthy",
  "service": "comfyui-runninghub"
}
```

---

## 核心端点 (/v1)

### POST /v1/upload — 上传文件

**multipart/form-data**

| 字段 | 类型 | 说明 |
|------|------|------|
| file | File | 文件 |
| fileType | string | 文件类型（如 "image"） |

**响应:**

```json
{
  "fileName": "uploaded_file_name.png"
}
```

### GET /v1/tasks/{task_id} — 查询任务状态

**响应:**

```json
{
  "taskId": "string",
  "status": "PENDING | RUNNING | SUCCESS | FAILED"
}
```

### GET /v1/tasks/{task_id}/outputs — 获取任务结果

**响应:**

```json
{
  "taskId": "string",
  "outputs": [
    "https://www.runninghub.cn/output/xxx/image.png"
  ]
}
```

---

## 动态工作流端点

### POST /v1/generate/{workflow_name} — 执行工作流

根据工作流名称动态路由，请求体为对应工作流的输入模型。

**示例:** `POST /v1/generate/text_to_image`

```json
{
  "prompt": "短款夹克，羊毛，墨绿色，复古街头",
  "negative_prompt": "",
  "width": 1024,
  "height": 1024
}
```

**响应:**

```json
{
  "taskId": "string"
}
```

---

## 便捷端点（Complete 系列）

合并文件上传与任务提交为一步操作。

### POST /v1/complete_image_edit — 图片改款

**multipart/form-data**

| 字段 | 类型 | 说明 |
|------|------|------|
| file | File | 主图片 |
| file_2 | File (可选) | 第 2 张图片 |
| file_3 | File (可选) | 第 3 张图片 |
| file_4 | File (可选) | 第 4 张图片 |
| prompt | string | 提示词 |

### POST /v1/complete_pattern_extract — 花型提取

**multipart/form-data**

| 字段 | 类型 | 说明 |
|------|------|------|
| file | File | 图片文件 |

### POST /v1/complete_seamless_pattern — 无缝花型

### POST /v1/complete_video_generation — 视频生成

### POST /v1/complete_image_layer — 分层编辑

---

## 工作流列表

通过 Swagger 文档或日志可查看所有已注册的工作流：

| 名称 | 功能 | 输入模式 |
|------|------|----------|
| `complete_image_edit` | 图片改款 | multipart（file + prompt） |
| `complete_pattern_extract` | 花型提取 | multipart（file） |
| `complete_seamless_pattern` | 无缝花型 | multipart |
| `complete_video_generation` | 视频生成 | multipart |
| `complete_image_layer` | 分层编辑 | multipart |
| `image_edit` | 基础编辑 | JSON（需预上传） |
| `text_to_image` | 文生服装 | JSON |
| `remove_background` | 背景移除 | JSON / multipart |
| `super_resolution` | 超分辨率 | JSON / multipart |
| `svg_vectorization` | SVG 矢量化 | JSON / multipart |
| `variant_overlay` | 配色叠加 | JSON / multipart |

---

## 任务状态枚举

| 状态 | 说明 |
|------|------|
| PENDING | 已提交，等待处理 |
| RUNNING | 正在执行 |
| SUCCESS | 执行成功 |
| FAILED | 执行失败 |
