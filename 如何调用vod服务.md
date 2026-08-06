# 如何调用 VOD 服务

## 目的

这份文档的目标不是复刻当前项目架构，而是说明：

1. 其他项目如何通过 OpenAI API 风格接入当前这套 VOD 图像服务。
2. 这套接入里哪些参数是客户端该用的，哪些是服务端内部凭据。
3. 当前仓库里已经确认的 VOD 配置值有哪些。

---

## 一句话结论

当前仓库里的 VOD 图像服务并不是直接对外暴露腾讯云 VOD 原生接口，而是通过 `tenant-service` 提供了一层 OpenAI Images API 风格兼容层。

对外应该调用：

- `POST /v1/images/generations`
- `POST /v1/images/edits`

但认证方式不是标准 OpenAI `api_key`，而是：

1. 先调用 `POST /auth/token` 登录拿到 JWT
2. 再把这个 JWT 放进 `Authorization: Bearer <token>`
3. 用 OpenAI Images 风格请求 `/v1/images/*`

也就是说，它是“接口形状兼容 OpenAI”，不是“鉴权模型兼容 OpenAI”。

---

## 架构关系

外部项目如果想接入，建议把它理解成下面三层：

1. 你的业务项目
2. OpenAI 风格网关：`tenant-service`
3. 腾讯云 VOD AIGC 图像能力

其中：

- 你的项目只需要对接 `tenant-service`
- `tenant-service` 再用服务端配置好的腾讯云凭据去调用 VOD
- 客户端不应该直接持有 `VOD_SECRET_ID` / `VOD_SECRET_KEY`

---

## 对外可调用的接口

## 1. 文本生图

接口：

```http
POST /v1/images/generations
Content-Type: application/json
Authorization: Bearer <JWT>
```

请求体最小示例：

```json
{
  "prompt": "a premium fashion editorial shot of a beige wool coat, clean studio lighting",
  "response_format": "url",
  "n": 1
}
```

说明：

- `prompt` 必填
- `response_format` 只支持 `url` 或 `b64_json`
- `n` 目前只支持 `1`
- `model` 字段即使传了，在 VOD 模式下也会被服务端忽略

返回示例：

```json
{
  "created": 1742200000,
  "data": [
    {
      "url": "https://..."
    }
  ],
  "_meta": {
    "task_id": "vod-task-id",
    "provider": "vod"
  }
}
```

如果 `response_format=b64_json`，则返回：

```json
{
  "created": 1742200000,
  "data": [
    {
      "b64_json": "iVBORw0KGgoAAA..."
    }
  ]
}
```

## 2. 图生图

接口：

```http
POST /v1/images/edits
Content-Type: multipart/form-data
Authorization: Bearer <JWT>
```

表单字段：

- `image`: 至少 1 张参考图，可多张
- `prompt`: 必填
- `response_format`: `url` 或 `b64_json`
- `n`: 只支持 `1`
- `model`: 可传，但在 VOD 模式下会被忽略

`curl` 示例：

```bash
curl -X POST "http://<tenant-host>:8081/v1/images/edits" \
  -H "Authorization: Bearer <JWT>" \
  -F "prompt=keep the garment silhouette, change fabric to dark indigo denim with refined stitching" \
  -F "response_format=url" \
  -F "n=1" \
  -F "image=@./reference.png"
```

---

## 认证方式

## 先登录，再调用 OpenAI 风格接口

当前实现要求先登录 tenant 服务获取 JWT。

登录接口：

```http
POST /auth/token
Content-Type: application/x-www-form-urlencoded
```

请求示例：

```bash
curl -X POST "http://<tenant-host>:8081/auth/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=your_user@example.com&password=your_password"
```

返回示例：

```json
{
  "access_token": "eyJhbGciOi...",
  "token_type": "bearer"
}
```

后续调用 `/v1/images/generations` 和 `/v1/images/edits` 时，使用：

```http
Authorization: Bearer <access_token>
```

## 重要说明

下面这些值都不能直接当成 OpenAI `api_key` 给客户端使用：

- `VOD_SECRET_ID`
- `VOD_SECRET_KEY`
- tenant 表里的 `api_key`

当前 OpenAI 兼容层真正认的是 JWT，不是上述任意一种 key。

---

## 其他项目怎么接

## 方案 A：直接按 HTTP 调用

最简单，任何语言都能接。

流程：

1. 调 `/auth/token` 拿 JWT
2. 保存 JWT
3. 调 `/v1/images/generations` 或 `/v1/images/edits`

适合：

- 后端服务
- 脚本任务
- 网关层
- 不方便改 SDK 的旧项目

## 方案 B：伪装成 OpenAI Base URL

如果你的项目已经封装了 OpenAI Images 调用逻辑，也可以把 `tenant-service` 当作一个“类 OpenAI Base URL”。

核心差异只有一条：

- OpenAI SDK 里的 `api_key` 位置，实际放的是 tenant 登录后拿到的 JWT

伪代码：

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://<tenant-host>:8081/v1",
    api_key="<JWT>"
)

result = client.images.generate(
    model="anything-you-like",
    prompt="a high-end apparel product shot, soft daylight",
    response_format="url"
)
```

注意：

- 这里 `model` 不决定最终 VOD 模型
- 最终真正生效的是服务端 `.env` 里的 `VOD_MODEL_NAME` 和 `VOD_MODEL_VERSION`
- 如果 SDK 强依赖标准 OpenAI 的更多字段，比如 `size`、`quality`、`background`，当前服务端并未实现

---

## 当前兼容层和 OpenAI Images API 的差异

目前已确认的差异如下：

- 只支持 `n=1`
- `response_format` 只支持 `url` 和 `b64_json`
- 图生图至少要有 1 张 `image`
- `size`、`quality`、`background`、`style` 等字段未实现
- VOD 模式下客户端传入的 `model` 被忽略
- 返回值里会额外带 `_meta`

因此，如果其他项目是“自己写 HTTP 请求”，接入会很顺。
如果其他项目是“严格按 OpenAI 官方完整 Images 参数集调用”，那就要做一层参数裁剪。

---

## VOD 模式下，服务端到底做了什么

为了让接入方知道边界，这里把服务端真实调用过程概括一下：

## 文本生图

服务端会向腾讯云 VOD 调用：

- `CreateAigcImageTask`
- 然后轮询 `DescribeTaskDetail`

服务端提交的核心参数是：

```json
{
  "SubAppId": 1408534747,
  "ModelName": "GEM",
  "ModelVersion": "3.1",
  "Prompt": "<你的提示词>",
  "OutputConfig": {
    "StorageMode": "Temporary"
  }
}
```

## 图生图

服务端会先做：

1. `ApplyUpload`
2. 用返回的临时凭证上传参考图到 COS
3. `CommitUpload`
4. `CreateAigcImageTask`
5. 轮询 `DescribeTaskDetail`

图生图任务的核心参数是：

```json
{
  "SubAppId": 1408534747,
  "ModelName": "GEM",
  "ModelVersion": "3.1",
  "FileInfos": [
    { "FileId": "xxx" }
  ],
  "Prompt": "<你的提示词>",
  "OutputConfig": {
    "StorageMode": "Temporary"
  }
}
```

这说明一件很重要的事：

客户端只需要提交图片和提示词，不需要自己实现腾讯云签名上传，也不需要自己轮询 VOD 任务。

---

## 当前仓库中已确认的配置值

以下内容是从当前仓库现有 `.env` 和部署文档中找到的。

## 1. tenant 服务当前已启用 VOD

在当前仓库里已确认：

```env
IMAGE_PROVIDER=vod
```

## 2. 当前 VOD 配置值

```env
VOD_SECRET_ID=YOUR_TENCENT_CLOUD_SECRET_ID
VOD_SECRET_KEY=YOUR_TENCENT_CLOUD_SECRET_KEY
VOD_REGION=ap-guangzhou
VOD_ENDPOINT=vod.tencentcloudapi.com
VOD_HTTP_TIMEOUT_MS=300000
VOD_SUB_APP_ID=1408534747
VOD_MODEL_NAME=GEM
VOD_MODEL_VERSION=3.1
VOD_TASK_POLL_INTERVAL_SECONDS=2
VOD_TASK_TIMEOUT_SECONDS=300
```

## 3. 这些值分别该怎么用

### 可以在服务端配置中使用

- `VOD_SECRET_ID`
- `VOD_SECRET_KEY`
- `VOD_REGION`
- `VOD_ENDPOINT`
- `VOD_SUB_APP_ID`
- `VOD_MODEL_NAME`
- `VOD_MODEL_VERSION`

### 不应该直接暴露给客户端

- `VOD_SECRET_ID`
- `VOD_SECRET_KEY`

### 客户端真正该拿到的是

- `/auth/token` 换来的 JWT

---

## 推荐给其他项目的接入姿势

如果你要指导其他项目接入，建议直接给他们下面这个结论：

1. 不要直连腾讯云 VOD 原生接口
2. 统一接入 `tenant-service` 的 `/v1/images/generations` 和 `/v1/images/edits`
3. 先登录拿 JWT，再把 JWT 当作 Bearer Token 调 OpenAI 风格接口
4. 不要指望客户端传 `model` 来切换 VOD 模型，模型由服务端统一配置
5. 把 `size`、`quality`、`style` 一类 OpenAI 扩展字段先去掉

这样其他项目的接入复杂度最低，也不需要理解腾讯云 VOD 的上传签名、任务轮询、COS 临时凭证这些细节。

---

## 最小接入示例

## 1. 先登录拿 JWT

```bash
curl -X POST "http://<tenant-host>:8081/auth/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=your_user@example.com&password=your_password"
```

## 2. 文本生图

```bash
curl -X POST "http://<tenant-host>:8081/v1/images/generations" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <JWT>" \
  -d '{
    "prompt": "a premium womenswear campaign image, minimal studio set, soft daylight",
    "response_format": "url",
    "n": 1
  }'
```

## 3. 图生图

```bash
curl -X POST "http://<tenant-host>:8081/v1/images/edits" \
  -H "Authorization: Bearer <JWT>" \
  -F "prompt=preserve silhouette, replace fabric with ivory tweed, add luxury editorial finish" \
  -F "response_format=url" \
  -F "n=1" \
  -F "image=@./input.png"
```

---

## 如果要进一步标准化

如果后续希望“真正像 OpenAI 一样接入”，建议再补两项能力：

1. 增加 API key 鉴权入口，而不是只支持 JWT 登录
2. 明确忽略或兼容更多 OpenAI Images 参数

这样其他项目就能更自然地把它当作标准 OpenAI 兼容图片服务来接。

---

## 核心结论

这套 VOD 图像能力的最佳接入方式，不是让其他项目直接研究腾讯云 VOD，而是：

- 把 `tenant-service` 当作 OpenAI Images 风格网关
- 把 JWT 当作 Bearer Token
- 把 VOD 的真实密钥和模型配置全部收敛在服务端

这就是当前仓库里最适合复用、也最容易推广到其他项目的接入方式。
