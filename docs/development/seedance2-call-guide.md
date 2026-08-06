# Seedance 2.0 调用指南

本文只记录已验证可用的调用方式。

## 接口

- 创建任务：`POST https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks`
- 查询任务：`GET https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks/{task_id}`

## SDK

```bash
pip install volcengine-python-sdk[ark]
```

```python
import os
import httpx
from volcenginesdkarkruntime import Ark

client = Ark(
    api_key=os.environ["ARK_API_KEY"],
    http_client=httpx.Client(trust_env=False),
)
```

## 文本 + 参考图

```python
result = client.content_generation.tasks.create(
    model="doubao-seedance-2-0-260128",
    content=[
        {
            "type": "text",
            "text": "让图中的模特在视频中转一圈，镜头稳定，保留人物特征",
        },
        {
            "type": "image_url",
            "image_url": {
                "url": "data:image/png;base64,....",
            },
            "role": "reference_image",
        },
    ],
    generate_audio=False,
    ratio="16:9",
    duration=5,
    watermark=True,
    timeout=60,
)

task_id = result.id
print(task_id)
```

## 轮询任务

```python
import time

while True:
    result = client.content_generation.tasks.get(task_id=task_id, timeout=60)
    if result.status == "succeeded":
        print(result.content.video_url)
        break
    if result.status == "failed":
        raise RuntimeError(result.error)
    time.sleep(30)
```

## 已验证的成功参数

- `model`: `doubao-seedance-2-0-260128`
- `ratio`: `16:9`
- `duration`: `5`
- `generate_audio`: `False`
- `watermark`: `True`

## 本地图片输入

本地图片可以先转成 base64，再放进 `image_url.url`：

```python
import base64
from pathlib import Path

image_path = Path(r"C:\VM-workshop\code\tmp\referenceIMG.png")
image_b64 = base64.b64encode(image_path.read_bytes()).decode("utf-8")
image_url = f"data:image/png;base64,{image_b64}"
```

然后把 `image_url` 放进上面的 `reference_image` 参数即可。

