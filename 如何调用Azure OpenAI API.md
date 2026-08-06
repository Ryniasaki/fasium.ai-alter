# 如何调用 Azure OpenAI API

这份文档记录了在 JOTO 环境里验证过的 Azure OpenAI 图片生成调用方式。

## 1. 已验证可用的接口

推荐使用新版接口：

```http
POST https://wcec-openai01.openai.azure.com/openai/v1/images/generations?api-version=preview
```

## 2. 必要请求头

```http
Content-Type: application/json
api-key: <你的 Azure OpenAI API Key>
Accept: application/json
```

## 3. 请求体

### 非流式调用

```json
{
  "model": "gpt-image-2",
  "prompt": "A small red fox on a white background, simple illustration",
  "n": 1,
  "size": "1024x1024"
}
```

### 流式调用

如果非流式调用遇到 `EngineOverloaded` 或连接长时间无响应，优先尝试流式模式：

```json
{
  "model": "gpt-image-2",
  "prompt": "A small red fox on a white background, simple illustration",
  "n": 1,
  "size": "1024x1024",
  "stream": true,
  "partial_images": 1
}
```

## 4. 实测结果

在 `2026-05-15` 的验证中：

- 非流式请求会出现 `429 EngineOverloaded`，或者长时间无响应后断开。
- 流式请求成功返回 `HTTP 200`，并收到 `image_generation.partial_image` 事件。
- 这说明：
  - 资源可达
  - API key 有效
  - `gpt-image-2` 部署存在且可用

## 5. Python 示例

下面的示例会读取 SSE 流，并把第一张 partial image 保存为 PNG：

```python
import base64
import json
import requests

url = "https://wcec-openai01.openai.azure.com/openai/v1/images/generations?api-version=preview"
headers = {
    "api-key": "<你的 Azure OpenAI API Key>",
    "Content-Type": "application/json",
    "Accept": "text/event-stream",
}
payload = {
    "model": "gpt-image-2",
    "prompt": "A small red fox on a white background, simple illustration",
    "n": 1,
    "size": "1024x1024",
    "stream": True,
    "partial_images": 1,
}

with requests.post(url, headers=headers, json=payload, stream=True, timeout=(30, 300)) as resp:
    resp.raise_for_status()
    for line in resp.iter_lines(decode_unicode=True):
        if not line:
            continue
        if line.startswith("data: "):
            data = json.loads(line[6:])
            if data.get("type") == "image_generation.partial_image":
                image_b64 = data["b64_json"]
                with open("azure-openai-preview.png", "wb") as f:
                    f.write(base64.b64decode(image_b64))
                break
```

## 6. PowerShell 示例

```powershell
$url = "https://wcec-openai01.openai.azure.com/openai/v1/images/generations?api-version=preview"
$headers = @{
  "api-key" = "<你的 Azure OpenAI API Key>"
  "Content-Type" = "application/json"
  "Accept" = "text/event-stream"
}
$body = @{
  model = "gpt-image-2"
  prompt = "A small red fox on a white background, simple illustration"
  n = 1
  size = "1024x1024"
  stream = $true
  partial_images = 1
} | ConvertTo-Json -Depth 5

Invoke-WebRequest -Uri $url -Method Post -Headers $headers -Body $body -TimeoutSec 300
```

## 7. 常见问题

### 返回 `429 EngineOverloaded`

这通常表示当前服务端过载，不是密钥错误。建议：

1. 等待一会再重试
2. 启用 `stream=true`
3. 保留重试和退避机制

### 旧路径不可用

旧式路径：

```http
/openai/deployments/<deployment>/images/generations?api-version=2024-02-01
```

在这次测试里表现不稳定，不建议继续作为主调用方式。优先使用新版：

```http
/openai/v1/images/generations?api-version=preview
```

## 8. 建议的生产调用策略

- 优先使用 `stream=true`
- 配置 3 到 5 次指数退避重试
- 记录返回的 `apim-request-id` 和 `x-request-id` 方便排障
- 如果只想做连通性验证，先请求一张小图并使用 `partial_images=1`

