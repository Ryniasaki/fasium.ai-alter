# 工作流架构说明

## 概述

新的工作流架构支持动态创建端点，每个工作流都有自己的专用端点：`/v1/generate/{workflow_name}`

## 架构特点

### 1. 动态端点生成
- 根据 `workflows/` 目录下的文件自动创建端点
- 每个工作流都有独立的端点：`POST /v1/generate/{workflow_name}`
- 支持不同的输入参数结构

### 2. 工作流定义
每个工作流需要实现以下接口：

```python
class Workflow(ABC):
    @property
    def webapp_id(self) -> str:  # Runninghub 工作流ID
    @property  
    def name(self) -> str:  # 工作流名称（用于URL）
    @property
    def display_name(self) -> str:  # 显示名称
    @property
    def description(self) -> str:  # 描述
    @property
    def input_model(self) -> Type[BaseModel]:  # 输入参数模型
    def get_node_info_list(self, **kwargs) -> List[Dict]:  # 生成节点配置
```

### 3. 输入参数模型
每个工作流可以定义自己的输入参数结构：

```python
class GuochaoPapercutInput(BaseModel):
    prompt: str = ""
    height: int = 1536
    width: int = 1024

class RealisticPortraitInput(BaseModel):
    prompt: str = ""
    style: str = "photorealistic"
    quality: str = "high"
    aspect_ratio: str = "1:1"
```

## 使用方法

### 1. 添加新工作流
1. 在 `workflows/` 目录下创建新的 `.py` 文件
2. 定义输入参数模型类
3. 实现工作流类，继承 `Workflow` 基类
4. 重启服务器，端点会自动创建

### 2. API 调用
```bash
# 国潮纸雕工作流
POST /v1/generate/guochao_papercut
{
  "prompt": "一个美丽的女孩",
  "height": 1536,
  "width": 1024
}

# 写实人像工作流  
POST /v1/generate/realistic_portrait
{
  "prompt": "一个美丽的女孩",
  "style": "photorealistic",
  "quality": "high",
  "aspect_ratio": "1:1"
}
```

### 3. 获取工作流列表
```bash
GET /v1/workflows
```

### 4. 获取工作流详情
```bash
GET /v1/workflows/{workflow_name}
```

## 文件结构

```
comfyui-runninghub/
├── workflows/
│   ├── __init__.py
│   ├── workflow_manager.py      # 工作流管理器
│   ├── guochao_papercut.py     # 国潮纸雕工作流
│   └── realistic_portrait.py   # 写实人像工作流
├── app/
│   ├── routers/
│   │   ├── v1.py               # 基础API端点
│   │   └── workflow_endpoints.py # 动态工作流端点
│   └── main.py
└── test.html                   # 测试页面
```

## 优势

1. **可扩展性**: 添加新工作流只需创建新文件，无需修改现有代码
2. **类型安全**: 每个工作流都有明确的输入参数类型
3. **独立性**: 每个工作流可以有不同的节点配置和参数
4. **动态性**: 端点根据工作流文件自动生成
5. **维护性**: 工作流逻辑集中管理，易于维护

## 示例工作流

### 国潮纸雕工作流
- 端点: `POST /v1/generate/guochao_papercut`
- 参数: `prompt`, `height`, `width`
- 节点: 6 (text), 58 (width/height)

### 写实人像工作流  
- 端点: `POST /v1/generate/realistic_portrait`
- 参数: `prompt`, `style`, `quality`, `aspect_ratio`
- 节点: 51 (text), 52 (width/height), 53 (quality)
