"""
动态工作流端点生成器
根据工作流定义自动创建端点
"""
from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, Form
from typing import Any, Dict, Optional
from pydantic import BaseModel
from ..services.runninghub_client import get_runninghub_client
from ..services.task_manager import get_task_manager
from ..services.logger import get_router_logger
from workflows.workflow_manager import workflow_manager

router = APIRouter()

# 尝试在导入时显式注册新工作流（防止动态扫描失败时缺失）
try:
    from workflows.complete_pattern_extract_workflow import (
        CompletePatternExtractWorkflow,
    )
    if "complete_pattern_extract" not in workflow_manager.workflows:
        workflow_manager.workflows["complete_pattern_extract"] = (
            CompletePatternExtractWorkflow()
        )
    from workflows.complete_seamless_pattern_workflow import (
        CompleteSeamlessPatternWorkflow,
    )
    if "complete_seamless_pattern" not in workflow_manager.workflows:
        workflow_manager.workflows["complete_seamless_pattern"] = (
            CompleteSeamlessPatternWorkflow()
        )
    from workflows.complete_video_generation_workflow import (
        CompleteVideoGenerationWorkflow,
    )
    if "complete_video_generation" not in workflow_manager.workflows:
        workflow_manager.workflows["complete_video_generation"] = (
            CompleteVideoGenerationWorkflow()
        )
    from workflows.text_to_image_workflow import TextToImageWorkflow
    if "text_to_image" not in workflow_manager.workflows:
        workflow_manager.workflows["text_to_image"] = TextToImageWorkflow()
    from workflows.super_resolution_workflow import SuperResolutionWorkflow
    if "super_resolution" not in workflow_manager.workflows:
        workflow_manager.workflows["super_resolution"] = SuperResolutionWorkflow()
    from workflows.complete_image_layer_workflow import CompleteImageLayerWorkflow
    if "complete_image_layer" not in workflow_manager.workflows:
        workflow_manager.workflows["complete_image_layer"] = CompleteImageLayerWorkflow()
    from workflows.remove_background_workflow import RemoveBackgroundWorkflow
    if "remove_background" not in workflow_manager.workflows:
        workflow_manager.workflows["remove_background"] = RemoveBackgroundWorkflow()
    from workflows.svg_vectorization_workflow import SvgVectorizationWorkflow
    if "svg_vectorization" not in workflow_manager.workflows:
        workflow_manager.workflows["svg_vectorization"] = SvgVectorizationWorkflow()
except Exception:
    # 静默忽略，端点内还有一次兜底注册
    pass

def create_workflow_endpoint(workflow_name: str):
    """为指定工作流创建端点"""
    
    # 获取工作流的输入模型
    input_model = workflow_manager.get_workflow_input_model(workflow_name)
    
    async def workflow_endpoint(
        payload: input_model,
        client = Depends(get_runninghub_client),
        task_manager = Depends(get_task_manager),
    ):
        logger = get_router_logger()
        try:
            logger.info(f"收到工作流请求: {workflow_name}, 参数: {payload.dict()}")
            
            # 通过工作流管理器获取工作流配置
            workflow_config = workflow_manager.execute_workflow(
                workflow_name,
                **payload.dict()
            )
            
            logger.info(f"工作流配置: webappId={workflow_config['webapp_id']}, 节点数量={len(workflow_config['node_info_list'])}")
            
            # 创建任务
            task_id = await client.create_task(
                webapp_id=workflow_config['webapp_id'],
                node_info_list=workflow_config['node_info_list'],
            )
            logger.info(f"创建任务成功，任务ID: {task_id}")

            if not task_id:
                raise HTTPException(status_code=500, detail="创建任务失败，未获取到任务ID")

            # 立即返回 TaskID，不等待任务完成
            return {
                "taskId": task_id,
                "status": "PENDING",
                "workflow": workflow_config['workflow_name'],
                "message": "任务已创建，请使用 taskId 查询任务状态"
            }
            
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"工作流 {workflow_name} 执行过程中出错: {str(e)}")
            raise HTTPException(status_code=500, detail=f"工作流执行失败: {str(e)}")
    
    return workflow_endpoint

def register_workflow_endpoints():
    """注册所有工作流的端点"""
    for workflow_name in workflow_manager.workflows.keys():
        workflow = workflow_manager.get_workflow(workflow_name)
        input_model = workflow.input_model
        
        # 创建端点函数
        endpoint_func = create_workflow_endpoint(workflow_name)
        
        # 添加端点到路由器
        router.add_api_route(
            f"/generate/{workflow_name}",
            endpoint_func,
            methods=["POST"],
            response_model=Dict[str, Any],
            summary=f"{workflow.display_name}",
            description=workflow.description,
            tags=[f"工作流: {workflow.display_name}"]
        )

# 注册所有工作流端点
register_workflow_endpoints()

@router.get("/workflows")
async def list_workflows():
    """获取可用的工作流列表"""
    return {"workflows": workflow_manager.list_workflows()}

@router.get("/workflows/{workflow_name}")
async def get_workflow_info(workflow_name: str):
    """获取指定工作流的详细信息"""
    try:
        workflow = workflow_manager.get_workflow(workflow_name)
        return {
            "name": workflow.name,
            "display_name": workflow.display_name,
            "description": workflow.description,
            "input_model": workflow.input_model.model_fields,
            "webapp_id": workflow.webapp_id
        }
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

@router.post("/complete_image_edit")
async def complete_image_edit(
    file: UploadFile = File(...),
    fileType: str = Form(default="image"),
    prompt: str = Form(...),
    file_2: Optional[UploadFile] = File(None),
    file_3: Optional[UploadFile] = File(None),
    file_4: Optional[UploadFile] = File(None),
    client = Depends(get_runninghub_client),
    task_manager = Depends(get_task_manager),
):
    """
    完整的图片编辑工作流
    接受multipart/form-data格式的请求，包含图片文件和编辑提示词
    """
    logger = get_router_logger()
    try:
        logger.info(f"收到完整图片编辑请求: 文件={file.filename}, 类型={fileType}, 提示词={prompt}")
        
        # 获取完整图片编辑工作流
        workflow = workflow_manager.get_workflow("complete_image_edit")
        
        # 执行完整的工作流
        result = await workflow.execute_workflow(
            file=file,
            fileType=fileType,
            prompt=prompt,
            file_2=file_2,
            file_3=file_3,
            file_4=file_4
        )
        
        logger.info(f"完整图片编辑工作流执行成功: {result}")
        return result
        
    except Exception as e:
        logger.error(f"完整图片编辑工作流执行失败: {str(e)}")
        raise HTTPException(status_code=500, detail=f"图片编辑失败: {str(e)}")

@router.post("/complete_pattern_extract")
async def complete_pattern_extract(
    file: UploadFile = File(...),
    fileType: str = Form(default="image"),
    client = Depends(get_runninghub_client),
    task_manager = Depends(get_task_manager),
):
    """
    完整印花提取工作流端点：接收图片文件并创建提取任务
    """
    logger = get_router_logger()
    try:
        logger.info(f"收到完整印花提取请求: 文件={file.filename}, 类型={fileType}")

        # 确保工作流已注册（容错：动态加载失败时，尝试显式注册）
        try:
            workflow = workflow_manager.get_workflow("complete_pattern_extract")
        except Exception:
            try:
                from workflows.complete_pattern_extract_workflow import (
                    CompletePatternExtractWorkflow,
                )
                wf = CompletePatternExtractWorkflow()
                workflow_manager.workflows[wf.name] = wf
                logger.info("已显式注册工作流 complete_pattern_extract")
                workflow = wf
            except Exception as reg_e:
                logger.error(f"显式注册工作流失败: {reg_e}")
                raise

        result = await workflow.execute_workflow(
            file=file,
            fileType=fileType,
        )

        logger.info(f"完整印花提取工作流执行成功: {result}")
        return result

    except Exception as e:
        logger.error(f"完整印花提取工作流执行失败: {str(e)}")
        raise HTTPException(status_code=500, detail=f"印花提取失败: {str(e)}")

@router.post("/complete_seamless_pattern")
async def complete_seamless_pattern(
    file: UploadFile = File(...),
    fileType: str = Form(default="image"),
    client = Depends(get_runninghub_client),
    task_manager = Depends(get_task_manager),
):
    """
    完整无缝图案生成工作流端点：接收图片文件并创建任务
    """
    logger = get_router_logger()
    try:
        logger.info(f"收到完整无缝图案生成请求: 文件={file.filename}, 类型={fileType}")

        try:
            workflow = workflow_manager.get_workflow("complete_seamless_pattern")
        except Exception:
            try:
                from workflows.complete_seamless_pattern_workflow import (
                    CompleteSeamlessPatternWorkflow,
                )
                wf = CompleteSeamlessPatternWorkflow()
                workflow_manager.workflows[wf.name] = wf
                logger.info("已显式注册工作流 complete_seamless_pattern")
                workflow = wf
            except Exception as reg_e:
                logger.error(f"显式注册工作流失败: {reg_e}")
                raise

        result = await workflow.execute_workflow(
            file=file,
            fileType=fileType,
        )

        logger.info(f"完整无缝图案生成工作流执行成功: {result}")
        return result

    except Exception as e:
        logger.error(f"完整无缝图案生成工作流执行失败: {str(e)}")
        raise HTTPException(status_code=500, detail=f"无缝图案生成失败: {str(e)}")

@router.post("/complete_image_layer")
async def complete_image_layer(
    file: UploadFile = File(...),
    fileType: str = Form(default="image"),
    client = Depends(get_runninghub_client),
    task_manager = Depends(get_task_manager),
):
    """
    图像分层工作流端点：接收图片文件并创建分层任务
    """
    logger = get_router_logger()
    try:
        logger.info(f"收到图像分层请求: 文件={file.filename}, 类型={fileType}")

        try:
            workflow = workflow_manager.get_workflow("complete_image_layer")
        except Exception:
            try:
                from workflows.complete_image_layer_workflow import CompleteImageLayerWorkflow
                wf = CompleteImageLayerWorkflow()
                workflow_manager.workflows[wf.name] = wf
                logger.info("已显式注册工作流 complete_image_layer")
                workflow = wf
            except Exception as reg_e:
                logger.error(f"显式注册工作流 complete_image_layer 失败: {reg_e}")
                raise

        result = await workflow.execute_workflow(
            file=file,
            fileType=fileType,
        )

        logger.info(f"图像分层工作流执行成功: {result}")
        return result

    except Exception as e:
        logger.error(f"图像分层工作流执行失败: {str(e)}")
        raise HTTPException(status_code=500, detail=f"图像分层失败: {str(e)}")

@router.post("/complete_video_generation")
async def complete_video_generation(
    file: UploadFile = File(...),
    prompt: str = Form(...),
    fileType: str = Form(default="image"),
    client = Depends(get_runninghub_client),
    task_manager = Depends(get_task_manager),
):
    """
    完整视频生成工作流端点：接收图片文件和提示词并创建视频生成任务
    """
    logger = get_router_logger()
    try:
        logger.info(f"收到完整视频生成请求: 文件={file.filename}, 类型={fileType}, 提示词={prompt}")

        # 确保工作流已注册（容错：动态加载失败时，尝试显式注册）
        try:
            workflow = workflow_manager.get_workflow("complete_video_generation")
        except Exception:
            try:
                from workflows.complete_video_generation_workflow import (
                    CompleteVideoGenerationWorkflow,
                )
                wf = CompleteVideoGenerationWorkflow()
                workflow_manager.workflows[wf.name] = wf
                logger.info("已显式注册工作流 complete_video_generation")
                workflow = wf
            except Exception as reg_e:
                logger.error(f"显式注册工作流失败: {reg_e}")
                raise

        result = await workflow.execute_workflow(
            file=file,
            prompt=prompt,
            fileType=fileType,
        )

        logger.info(f"完整视频生成工作流执行成功: {result}")
        return result

    except Exception as e:
        logger.error(f"完整视频生成工作流执行失败: {str(e)}")
        raise HTTPException(status_code=500, detail=f"视频生成失败: {str(e)}")

@router.post("/super_resolution")
async def super_resolution(
    file: UploadFile = File(...),
    fileType: str = Form(default="image"),
    client = Depends(get_runninghub_client),
    task_manager = Depends(get_task_manager),
):
    """
    超级分辨率工作流端点：接收图片文件并创建超级分辨率任务
    """
    logger = get_router_logger()
    try:
        logger.info(f"收到超级分辨率请求: 文件={file.filename}, 类型={fileType}")

        try:
            workflow = workflow_manager.get_workflow("super_resolution")
        except Exception:
            try:
                from workflows.super_resolution_workflow import SuperResolutionWorkflow
                wf = SuperResolutionWorkflow()
                workflow_manager.workflows[wf.name] = wf
                logger.info("已显式注册工作流 super_resolution")
                workflow = wf
            except Exception as reg_e:
                logger.error(f"显式注册工作流 super_resolution 失败: {reg_e}")
                raise

        result = await workflow.execute_workflow(
            file=file,
            fileType=fileType,
        )

        logger.info(f"超级分辨率工作流执行成功: {result}")
        return result

    except Exception as e:
        logger.error(f"超级分辨率工作流执行失败: {str(e)}")
        raise HTTPException(status_code=500, detail=f"超级分辨率失败: {str(e)}")

@router.post("/remove_background")
async def remove_background(
    file: UploadFile = File(...),
    fileType: str = Form(default="image"),
    client = Depends(get_runninghub_client),
    task_manager = Depends(get_task_manager),
):
    """
    去背景工作流端点：接收图片文件并创建去除背景任务
    """
    logger = get_router_logger()
    try:
        logger.info(f"收到去除背景请求: 文件={file.filename}, 类型={fileType}")

        try:
            workflow = workflow_manager.get_workflow("remove_background")
        except Exception:
            try:
                from workflows.remove_background_workflow import RemoveBackgroundWorkflow

                wf = RemoveBackgroundWorkflow()
                workflow_manager.workflows[wf.name] = wf
                logger.info("已显式注册工作流 remove_background")
                workflow = wf
            except Exception as reg_e:
                logger.error(f"显式注册工作流 remove_background 失败: {reg_e}")
                raise

        result = await workflow.execute_workflow(
            file=file,
            fileType=fileType,
        )

        logger.info(f"去除背景工作流执行成功: {result}")
        return result

    except Exception as e:
        logger.error(f"去除背景工作流执行失败: {str(e)}")
        raise HTTPException(status_code=500, detail=f"去除背景失败: {str(e)}")

@router.post("/svg_vectorization")
async def svg_vectorization(
    file: UploadFile = File(...),
    fileType: str = Form(default="image"),
    client = Depends(get_runninghub_client),
    task_manager = Depends(get_task_manager),
):
    """
    矢量化工作流端点：接收图片文件并创建矢量化任务
    """
    logger = get_router_logger()
    try:
        logger.info(f"收到矢量化请求: 文件={file.filename}, 类型={fileType}")

        try:
            workflow = workflow_manager.get_workflow("svg_vectorization")
        except Exception:
            try:
                from workflows.svg_vectorization_workflow import SvgVectorizationWorkflow
                wf = SvgVectorizationWorkflow()
                workflow_manager.workflows[wf.name] = wf
                logger.info("已显式注册工作流 svg_vectorization")
                workflow = wf
            except Exception as reg_e:
                logger.error(f"显式注册工作流 svg_vectorization 失败: {reg_e}")
                raise

        result = await workflow.execute_workflow(
            file=file,
            fileType=fileType,
        )

        logger.info(f"矢量化工作流执行成功: {result}")
        return result

    except Exception as e:
        logger.error(f"矢量化工作流执行失败: {str(e)}")
        raise HTTPException(status_code=500, detail=f"矢量化失败: {str(e)}")

@router.post("/variant_overlay")
async def variant_overlay(
    file: Optional[UploadFile] = File(None),
    imageName: str = Form(default=""),
    fileType: str = Form(default="image"),
):
    """
    Variant overlay workflow endpoint: accept an image file or existing image name,
    upload if necessary, and trigger the overlay workflow.
    """
    logger = get_router_logger()
    try:
        logger.info(f"收到 variant overlay 请求: file={getattr(file, 'filename', None)}, imageName={imageName}")

        # Ensure workflow registered
        try:
            workflow = workflow_manager.get_workflow("variant_overlay")
        except Exception:
            try:
                from workflows.variant_overlay_workflow import VariantOverlayWorkflow
                wf = VariantOverlayWorkflow()
                workflow_manager.workflows[wf.name] = wf
                logger.info("已显式注册工作流 variant_overlay")
                workflow = wf
            except Exception as reg_e:
                logger.error(f"显式注册 variant_overlay 工作流失败: {reg_e}")
                raise

        if not file and not imageName:
            raise HTTPException(status_code=400, detail="必须提供图片文件或已上传图片名称")

        result = await workflow.execute_workflow(
            file=file,
            fileType=fileType,
            image_name=imageName,
        )

        logger.info(f"Variant overlay 工作流执行成功: {result}")
        return result

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Variant overlay 工作流执行失败: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Variant overlay 失败: {str(e)}")
