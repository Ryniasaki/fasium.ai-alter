# Redesign 功能测试指南

## 测试环境准备

### 1. 启动服务
确保以下服务都在运行：

```bash
# 1. 启动 comfyui-runninghub (端口 8080)
cd comfyui-runninghub
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8080

# 2. 启动 comfyui-tenant-service (端口 8081)
cd comfyui-tenant-service
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8081

# 3. 启动 comfyui-clothing (端口 3000)
cd comfyui-clothing
npm install
npm run dev
```

### 2. 配置环境变量

#### comfyui-tenant-service/.env
```env
# 默认使用 json (最简单，无需数据库)
STORAGE_TYPE=json

# 后端服务配置
RUNNINGHUB_SERVICE_URL=http://localhost:8080
```

#### comfyui-clothing/.env.local
```env
NEXT_PUBLIC_TENANT_API_URL=http://localhost:8081
```

## 测试步骤

### 1. 用户注册和登录
1. 访问 `http://localhost:3000`
2. 点击 "Try Free Demo" 或 "Log in"
3. 注册新用户或登录现有用户
4. 确认用户信息显示正确

### 2. 测试 Redesign 功能
1. 访问 `http://localhost:3000/redesign`
2. 上传一张服装图片
3. 使用绘画工具标记需要修改的区域
4. 输入重新设计的提示词，例如：
   - "Change the color to navy blue"
   - "Add floral patterns"
   - "Make it more elegant"
5. 点击 "Start Processing"
6. 观察处理状态和进度
7. 查看最终结果

### 3. 验证多租户隔离
1. 使用不同用户账号登录
2. 分别上传不同的图片
3. 确认每个用户只能看到自己的处理结果

## 预期结果

### 成功场景
- ✅ 图片上传成功，返回图片名称
- ✅ 处理请求提交成功，返回 taskId
- ✅ 实时显示处理状态和进度
- ✅ 最终显示重新设计后的图片
- ✅ 不同用户的数据完全隔离

### 错误处理
- ❌ 未登录用户自动重定向到首页
- ❌ 上传失败时显示错误信息
- ❌ 处理失败时显示具体错误原因
- ❌ 网络错误时显示重试提示

## API 端点测试

### 1. 图片上传测试
```bash
curl -X POST http://localhost:8081/proxy/upload \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "file=@test-image.jpg" \
  -F "fileType=image"
```

### 2. 图片编辑测试
```bash
curl -X POST http://localhost:8081/proxy/generate/image_edit \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Change the color to navy blue",
    "image_name": "uploaded-image-name.jpg"
  }'
```

### 3. 任务状态查询
```bash
curl -X GET http://localhost:8081/proxy/tasks/TASK_ID \
  -H "Authorization: Bearer YOUR_TOKEN"
```

## 故障排除

### 常见问题

1. **404 错误**
   - 检查服务是否启动
   - 确认端口配置正确
   - 检查路由前缀设置

2. **认证失败**
   - 确认用户已登录
   - 检查 token 是否有效
   - 验证 Authorization 头格式

3. **文件上传失败**
   - 检查文件大小限制
   - 确认文件格式支持
   - 验证 multipart/form-data 处理

4. **处理超时**
   - 检查后端服务状态
   - 确认 Runninghub API 可用
   - 调整超时设置

### 日志查看

#### comfyui-tenant-service 日志
```bash
# 查看代理请求日志
tail -f logs/proxy/$(date +%Y%m%d%H).log

# 查看认证日志
tail -f logs/auth/$(date +%Y%m%d%H).log
```

#### comfyui-runninghub 日志
```bash
# 查看上传日志
tail -f logs/runninghub_client/$(date +%Y%m%d%H).log

# 查看任务处理日志
tail -f logs/task_manager/$(date +%Y%m%d%H).log
```

## 性能测试

### 并发测试
使用多个浏览器标签页同时进行测试：
1. 同时上传多张图片
2. 并发提交多个处理请求
3. 验证系统稳定性

### 大文件测试
1. 上传大尺寸图片（>10MB）
2. 测试处理时间
3. 验证内存使用情况

## 安全测试

### 认证测试
1. 使用无效 token 访问
2. 测试 token 过期处理
3. 验证用户权限隔离

### 数据隔离测试
1. 不同用户访问相同 taskId
2. 验证数据访问权限
3. 测试跨租户数据泄露防护

