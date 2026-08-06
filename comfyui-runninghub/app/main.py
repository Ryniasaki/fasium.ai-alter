from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .routers.v1 import router as v1_router
from .routers.workflow_endpoints import router as workflow_router
from .services.logger import get_main_logger
from .services.metrics import setup_metrics


def create_app() -> FastAPI:
    logger = get_main_logger()
    logger.info("启动 ComfyUI Runninghub API 服务器")
    
    app = FastAPI(title="ComfyUI Runninghub API", version="0.1.0")
    setup_metrics(app, service_name="runninghub-service")

    # 允许本地测试页面（file:// 或 http://localhost）跨域调用
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "http://localhost:8080",
            "http://127.0.0.1:8080",
            "https://fashion.jototech.cn",
            "https://fasium.cn",
            "https://fasium.ai",
        ],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["*"],
    )
    app.include_router(v1_router, prefix="/v1")
    app.include_router(workflow_router, prefix="/v1")
    
    # 添加健康检查端点
    @app.get("/health")
    async def health_check():
        return {"status": "healthy", "service": "comfyui-runninghub"}

    @app.get("/ready")
    async def readiness_check():
        return {"ready": True, "service": "comfyui-runninghub"}
    
    logger.info("服务器配置完成")
    return app


app = create_app()

