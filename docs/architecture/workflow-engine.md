# 工作流引擎架构

## 概述

RunningHub Service 通过 WorkflowManager 管理所有 AI 工作流，每个工作流是一个 Python 类，定义了输入参数和 ComfyUI 节点配置。工作流在启动时自动发现和注册，支持通过统一的动态端点调用。

## WorkflowManager 机制

### 自动发现

启动时 WorkflowManager 扫描 `workflows/` 目录下所有 `.py` 文件，查找继承自 `Workflow` 基类的子类并实例化注册：

```python
# workflows/ 目录下的所有 .py 文件会被自动加载
# 无需手动注册，只需创建文件并定义 Workflow 子类
```

### Workflow 基类

每个工作流必须实现以下属性和方法：

```python
class Workflow(ABC):
    @property
    def webapp_id(self) -> str: ...       # Runninghub.cn 上的应用 ID
    @property
    def name(self) -> str: ...            # 工作流名称（用作 URL 路径）
    @property
    def display_name(self) -> str: ...    # 显示名称
    @property
    def description(self) -> str: ...     # 描述
    @property
    def input_model(self) -> Type[BaseModel]: ...  # Pydantic 输入模型

    def get_node_info_list(self, **kwargs) -> List[Dict]: ...  # 生成节点配置
```

### 执行流程

```
1. WorkflowManager.execute_workflow(name, **params)
2. → 调用 workflow.get_node_info_list(**params) 生成 node_info_list
3. → 返回 { webapp_id, node_info_list, workflow_name }
4. → RunninghubClient 将配置提交至 Runninghub.cn API
5. → 返回 taskId
```

## 动态端点

`workflow_endpoints.py` 基于已注册的工作流自动生成 REST 端点：

```
POST /v1/generate/{workflow_name}
```

请求体为对应工作流的 `input_model` 定义。

## 便捷端点（Complete 端点）

部分高频工作流提供了"完整端点"，合并文件上传与任务提交为一步操作：

| 端点 | 说明 |
|------|------|
| `POST /v1/complete_image_edit` | 上传图片 + 提交改款任务 |
| `POST /v1/complete_pattern_extract` | 上传图片 + 提交花型提取任务 |
| `POST /v1/complete_seamless_pattern` | 上传图片 + 提交无缝花型任务 |
| `POST /v1/complete_video_generation` | 上传图片 + 提交视频生成任务 |
| `POST /v1/complete_image_layer` | 上传图片 + 提交分层编辑任务 |

## 现有工作流清单

| 名称 | 文件 | 功能 |
|------|------|------|
| complete_image_edit | `complete_image_edit_workflow.py` | 图片改款/局部重绘 |
| complete_pattern_extract | `complete_pattern_extract_workflow.py` | 花型/纹理提取 |
| complete_seamless_pattern | `complete_seamless_pattern_workflow.py` | 无缝花型生成 |
| complete_video_generation | `complete_video_generation_workflow.py` | 视频生成 |
| complete_image_layer | `complete_image_layer_workflow.py` | 分层图片编辑 |
| image_edit | `image_edit_workflow.py` | 基础图片编辑（需预上传） |
| text_to_image | `text_to_image_workflow.py` | 文生服装 |
| remove_background | `remove_background_workflow.py` | 背景移除 |
| super_resolution | `super_resolution_workflow.py` | 超分辨率放大 |
| svg_vectorization | `svg_vectorization_workflow.py` | SVG 矢量化 |
| variant_overlay | `variant_overlay_workflow.py` | 配色/面料叠加对比 |

## node_info_list 结构

每个工作流生成的节点配置遵循 Runninghub.cn API 格式：

```json
[
  {
    "nodeId": "224",
    "fieldName": "image",
    "fieldValue": "uploaded_image_name.png"
  },
  {
    "nodeId": "101",
    "fieldName": "text",
    "fieldValue": "用户输入的提示词"
  }
]
```

## 与 Runninghub.cn 的交互

RunninghubClient 封装了对云端 API 的所有调用：

| 操作 | 云端端点 |
|------|----------|
| 上传文件 | `POST /task/openapi/upload` |
| 提交任务 | `POST /task/openapi/ai-app/run` |
| 查询状态 | `POST /task/openapi/status` |
| 获取结果 | `POST /task/openapi/outputs` |

配置项：
- `RUNNINGHUB_API_KEY` — API 密钥
- `RUNNINGHUB_HOST` — 默认 `https://www.runninghub.cn`
- `REQUEST_TIMEOUT_SECONDS` — 请求超时（默认 60s）
- `POLL_INTERVAL_SECONDS` — 轮询间隔（默认 8s）
- `MAX_POLL_SECONDS` — 最大轮询时间（默认 300s）

## 新增工作流

详见 [新增工作流指南](../development/adding-workflow.md)。
