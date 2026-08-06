from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional
from ..services.runninghub_client import get_runninghub_client
from ..services.task_manager import get_task_manager
from ..services.logger import get_router_logger

router = APIRouter()


@router.post("/upload")
async def upload_file(
    file: UploadFile = File(...),
    fileType: str = Form(...),
    client = Depends(get_runninghub_client),
):
    try:
        result = await client.upload_file(file=file, file_type=fileType)
        return {"fileName": result}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/tasks/{task_id}")
async def get_task_status(
    task_id: str,
    task_manager = Depends(get_task_manager),
):
    status = await task_manager.get_status(task_id)
    return {"taskId": task_id, "status": status}


@router.get("/tasks/{task_id}/outputs")
async def get_task_outputs(
    task_id: str,
    client = Depends(get_runninghub_client),
):
    outputs = await client.get_outputs(task_id)
    return {"taskId": task_id, "outputs": outputs}



