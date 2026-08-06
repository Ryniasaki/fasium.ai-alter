# 新增工作流指南

本文档说明如何在 RunningHub Service 中添加一个新的 AI 工作流。

## 步骤一：创建工作流文件

在 `comfyui-runninghub/workflows/` 目录下新建 Python 文件，例如 `my_new_workflow.py`。

## 步骤二：定义输入模型和工作流类

```python
from pydantic import BaseModel, Field
from typing import List, Dict, Any, Type
from .workflow_manager import Workflow


class MyNewWorkflowInput(BaseModel):
    """工作流输入参数"""
    image_name: str = Field(..., description="已上传的图片文件名")
    prompt: str = Field(..., description="文本提示词")
    strength: float = Field(0.8, description="生成强度")


class MyNewWorkflow(Workflow):
    """我的新工作流"""

    @property
    def webapp_id(self) -> str:
        return "your_webapp_id_from_runninghub"  # 从 Runninghub.cn 获取

    @property
    def name(self) -> str:
        return "my_new_workflow"  # URL 路径名称

    @property
    def display_name(self) -> str:
        return "我的新工作流"

    @property
    def description(self) -> str:
        return "工作流功能描述"

    @property
    def input_model(self) -> Type[BaseModel]:
        return MyNewWorkflowInput

    def get_node_info_list(self, **kwargs) -> List[Dict[str, Any]]:
        """根据输入参数生成 ComfyUI 节点配置"""
        return [
            {
                "nodeId": "224",
                "fieldName": "image",
                "fieldValue": kwargs.get("image_name", "")
            },
            {
                "nodeId": "101",
                "fieldName": "text",
                "fieldValue": kwargs.get("prompt", "")
            },
            {
                "nodeId": "102",
                "fieldName": "strength",
                "fieldValue": str(kwargs.get("strength", 0.8))
            }
        ]
```

## 步骤三：自动注册

无需手动注册。WorkflowManager 在启动时会自动扫描 `workflows/` 目录，发现并注册所有 `Workflow` 子类。

重启 RunningHub Service 后，新工作流自动可用：

```
POST /v1/generate/my_new_workflow
```

可通过 Swagger 文档 `http://localhost:8080/docs` 查看新端点。

## 步骤四（可选）：添加 Complete 端点

如果工作流需要合并文件上传和任务提交，可在 `app/routers/v1.py` 中添加便捷端点：

```python
@router.post("/complete_my_new_workflow")
async def complete_my_new_workflow(
    file: UploadFile = File(...),
    prompt: str = Form(...),
    strength: float = Form(0.8),
    client=Depends(get_runninghub_client),
):
    # 1. 上传文件
    file_name = await client.upload_file(file=file, file_type="image")

    # 2. 执行工作流
    from workflows.workflow_manager import workflow_manager
    workflow_config = workflow_manager.execute_workflow(
        "my_new_workflow",
        image_name=file_name,
        prompt=prompt,
        strength=strength,
    )

    # 3. 提交任务
    task_id = await client.run_task(
        webapp_id=workflow_config["webapp_id"],
        node_info_list=workflow_config["node_info_list"],
    )

    return {"taskId": task_id}
```

## 步骤五：前端对接

### 1. 在 Tenant Service 添加代理端点

在 `comfyui-tenant-service/app/routers/proxy.py` 中添加转发逻辑。

### 2. 在前端添加 API Route

在 `comfyui-clothing/app/api/proxy/` 下创建对应的 `route.ts`。

### 3. 创建 API 客户端

在 `lib/` 下创建对应的 API 客户端文件，封装提交、轮询、完成逻辑。

### 4. 创建页面

在 `app/` 下创建功能页面，调用 API 客户端。

## 测试验证

1. 启动 RunningHub Service，确认日志中出现 `加载工作流: my_new_workflow`
2. 通过 Swagger `http://localhost:8080/docs` 测试 `/v1/generate/my_new_workflow`
3. 通过前端页面执行完整流程（提交 → 轮询 → 查看结果）
