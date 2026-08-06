# sora2调用方法

## 1. 已验证可用的基础信息
- Base URL: `https://work.poloapi.com`
- 创建接口: `POST /v1/videos`
- 查询接口: `GET /v1/videos/{task_id}`
- 鉴权头: `Authorization: sk-...`（注意这里不是 Bearer 前缀）
- 实测可用 API Key: `sk-RQrZSRx2eEWv72GxYvwE15xMUa9nXULJyDiKLaDmlSs9BUPf`
- 模型名称（实测）:
  - 可用: `sora-2-pro`
  - `sora-2-pro-guan` 需要输入图尺寸严格匹配 `size`

## 2. 创建视频（图生视频）
使用 `multipart/form-data`，字段如下：
- `model`: `sora-2-pro`
- `prompt`: 文本提示词
- `input_reference`: 输入图片文件
- `seconds`: 建议传 `12`
- `size`: 如 `1280x720`

示例命令：
```bash
curl -i -X POST "https://work.poloapi.com/v1/videos" \
  -H "Authorization: sk-RQrZSRx2eEWv72GxYvwE15xMUa9nXULJyDiKLaDmlSs9BUPf" \
  -H "Accept: application/json" \
  -F "model=sora-2-pro" \
  -F "prompt=让图片中的字体轻微上下浮动，镜头固定" \
  -F "seconds=12" \
  -F "size=1280x720" \
  -F "input_reference=@C:/Users/admin/Desktop/poster demo/Font.png;type=image/png"
```

成功响应示例（实测）：
```json
{
  "id": "task_xFQ6QDMVCcHtnqwQun5ATuxROhrrqg1q",
  "task_id": "task_xFQ6QDMVCcHtnqwQun5ATuxROhrrqg1q",
  "object": "video",
  "model": "sora-2-pro",
  "status": "completed",
  "progress": 100,
  "created_at": 1772504013,
  "seconds": "12",
  "size": "720x1280",
  "url": "https://image.cdn2.seaart.me/upload/static/20260303/fe9c8ffc-2fea-4cc9-9f04-fda7406f4cdb.mp4"
}
```

## 3. 查询任务状态
示例命令：
```bash
curl -i -X GET "https://work.poloapi.com/v1/videos/task_xFQ6QDMVCcHtnqwQun5ATuxROhrrqg1q" \
  -H "Authorization: sk-RQrZSRx2eEWv72GxYvwE15xMUa9nXULJyDiKLaDmlSs9BUPf" \
  -H "Accept: application/json"
```

实测响应（节选）：
```json
{
  "id": "task_Vh0dnsNBNwaO6ydYyzwh6qJxPDOTI5II",
  "model": "sora-2-pro",
  "object": "video",
  "status": "completed",
  "progress": 100,
  "seconds": "12",
  "size": "720x1280",
  "url": "https://image.cdn2.seaart.me/upload/static/20260303/fe9c8ffc-2fea-4cc9-9f04-fda7406f4cdb.mp4"
}
```

## 4. 常见错误
- `403 该令牌无权访问模型 sora-2-pro`
  - 说明 API Key 没有该模型权限。
- `400 Inpaint image must match the requested width and height`
  - 输入图尺寸与 `size` 不匹配，需要对齐。
- `401 无效的令牌`
  - key 不可用或域名不匹配。

## 5. 备注
- `POST /v1/chat/completions` 不适合这个视频模型流程，建议直接走 `POST /v1/videos`。
- 如需在项目中接入，建议按“创建任务 + 轮询 GET /v1/videos/{task_id} + 成功后入库”实现。
