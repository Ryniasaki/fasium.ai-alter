# ComfyUI Runninghub FastAPI Architecture

## Overview
FastAPI microservice for Runninghub AI image generation integration.

## Core Services

### RunninghubClient (`app/services/runninghub_client.py`)
- **Purpose**: HTTP client for Runninghub API
- **Methods**:
  - `upload_file(file, file_type) -> str`: Upload file to Runninghub
  - `create_task(webapp_id, node_info_list) -> str`: Create AI generation task
  - `get_status(task_id) -> str`: Query task status
  - `get_outputs(task_id) -> list[str]`: Get task results
- **Dependencies**: httpx, config settings
- **Logging**: `logs/runninghub_client/YYYYMMDDHH.log`

### TaskManager (`app/services/task_manager.py`)
- **Purpose**: Task polling and completion monitoring
- **Methods**:
  - `poll_task_until_complete(task_id) -> str`: Poll until SUCCESS/FAILED/TIMEOUT
  - `get_status(task_id) -> str`: Get current task status
- **Configuration**: `POLL_INTERVAL_SECONDS`, `MAX_POLL_SECONDS`
- **Logging**: `logs/task_manager/YYYYMMDDHH.log`

### Router (`app/routers/v1.py`)
- **Purpose**: API endpoint handlers
- **Endpoints**:
  - `POST /v1/upload`: File upload
  - `POST /v1/generate`: AI generation with polling
  - `GET /v1/tasks/{task_id}`: Task status query
  - `GET /v1/tasks/{task_id}/outputs`: Task results
- **Request Model**: `GenerateRequest(webappId: str, nodeInfoList: list[dict])`
- **Logging**: `logs/router/YYYYMMDDHH.log`

## Configuration (`app/services/config.py`)
```python
class Settings:
    runninghub_api_key: str
    runninghub_host: str = "https://www.runninghub.cn"
    request_timeout_seconds: int = 60
    poll_interval_seconds: int = 5
    max_poll_seconds: int = 300
```

## Logging System (`app/services/logger.py`)
- **ServiceLogger**: Per-service loggers with hourly file rotation
- **Log Levels**: DEBUG, INFO, WARNING, ERROR
- **File Structure**: `logs/{service_name}/{YYYYMMDDHH}.log`
- **Services**: runninghub_client, task_manager, router, main

## API Integration

### Runninghub API Endpoints
- Upload: `POST /task/openapi/upload`
- Create Task: `POST /task/openapi/ai-app/run`
- Status: `POST /task/openapi/status`
- Outputs: `POST /task/openapi/outputs`

### Request Format
```json
{
  "webappId": "1970434031953342465",
  "apiKey": "0d4db9a40bdd402a8f902ba6007dcef0",
  "nodeInfoList": [
    {
      "nodeId": "6",
      "fieldName": "text",
      "fieldValue": "prompt text",
      "description": "text"
    },
    {
      "nodeId": "58",
      "fieldName": "height",
      "fieldValue": "1536",
      "description": "height"
    },
    {
      "nodeId": "58",
      "fieldName": "width",
      "fieldValue": "1024",
      "description": "width"
    }
  ]
}
```

## Dependencies
- fastapi==0.115.0
- uvicorn[standard]==0.30.6
- httpx==0.27.2
- python-multipart==0.0.9
- tenacity==9.0.0
- pydantic-settings==2.5.2

## File Structure
```
comfyui-runninghub/
├── app/
│   ├── main.py
│   ├── routers/v1.py
│   └── services/
│       ├── config.py
│       ├── logger.py
│       ├── runninghub_client.py
│       └── task_manager.py
├── logs/
│   ├── runninghub_client/
│   ├── task_manager/
│   ├── router/
│   └── main/
├── requirements.txt
├── .env
└── start.bat
```

## Environment Variables
- `RUNNINGHUB_API_KEY`: API key for Runninghub
- `RUNNINGHUB_HOST`: Runninghub base URL
- `REQUEST_TIMEOUT_SECONDS`: HTTP request timeout
- `POLL_INTERVAL_SECONDS`: Task polling interval
- `MAX_POLL_SECONDS`: Maximum polling duration
