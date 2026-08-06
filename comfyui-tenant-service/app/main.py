from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.responses import RedirectResponse
from starlette.exceptions import HTTPException as StarletteHTTPException
from sqlalchemy import text
from redis import Redis
import httpx
import asyncio
import uuid
from .routers import auth, tenants, proxy, sheet, admin, reports, models, ws, analytics, openai_images, payments, feedback
from .services.logger import get_main_logger
from .services.database_init import init_database
from .services.config import get_settings
from .services.image_storage import image_storage_service
from .services.errors import ErrorPayload, infer_error_code, status_to_error_code
from .services.metrics import setup_metrics
from .models.database import engine as db_engine
from autorun.running_tasks_monitor import running_tasks_monitor
from autorun.report_auto_converter import report_auto_converter
from autorun.database_backup import database_backup_scheduler

def create_app() -> FastAPI:
    logger = get_main_logger()
    settings = get_settings()
    
    logger.info("启动多租户微服务")
    
    # 显示存储配置信息
    storage_info = settings.get_storage_info()
    logger.info(f"存储配置: {storage_info['type']}")
    if storage_info['type'] == 'JSON':
        logger.info(f"JSON 存储路径: {storage_info['path']}")
    elif storage_info['type'] == 'MySQL':
        logger.info(f"MySQL 连接: {storage_info['user']}@{storage_info['host']}:{storage_info['port']}/{storage_info['database']}")
    elif storage_info['type'] == 'SQLite':
        logger.info(f"SQLite 文件: {storage_info['path']}")
    
    # Initialize database
    logger.info("初始化数据库...")
    if init_database():
        logger.info("数据库初始化成功")
    else:
        logger.warning("数据库初始化失败，使用 JSON 存储")
    
    app = FastAPI(
        title="ComfyUI Tenant Service",
        version="0.1.0",
        description="Multi-tenant microservice for ComfyUI Runninghub"
    )
    setup_metrics(app, service_name="tenant-service")

    @app.middleware("http")
    async def add_request_id(request: Request, call_next):
        request_id = request.headers.get("x-request-id") or str(uuid.uuid4())
        request.state.request_id = request_id
        response = await call_next(request)
        response.headers["x-request-id"] = request_id
        return response

    def _extract_http_exception_message(detail: object) -> str:
        if isinstance(detail, str):
            return detail
        if isinstance(detail, dict):
            if "message" in detail and isinstance(detail["message"], str):
                return detail["message"]
            if "detail" in detail and isinstance(detail["detail"], str):
                return detail["detail"]
            return "Request failed"
        if isinstance(detail, list):
            return "Request validation failed"
        return "Request failed"

    def _json_error_response(status_code: int, payload: ErrorPayload) -> JSONResponse:
        response = JSONResponse(status_code=status_code, content=payload.to_dict())
        response.headers["x-request-id"] = payload.request_id
        return response

    @app.exception_handler(HTTPException)
    async def http_exception_handler(request: Request, exc: HTTPException):
        request_id = getattr(request.state, "request_id", str(uuid.uuid4()))
        code = infer_error_code(exc.status_code, exc.detail).value
        message = _extract_http_exception_message(exc.detail)
        details = exc.detail if isinstance(exc.detail, (dict, list)) else None
        retryable = exc.status_code in (502, 503, 504)

        payload = ErrorPayload(
            code=code,
            message=message,
            details=details,
            request_id=request_id,
            retryable=retryable,
        )
        return _json_error_response(exc.status_code, payload)

    @app.exception_handler(StarletteHTTPException)
    async def starlette_http_exception_handler(request: Request, exc: StarletteHTTPException):
        request_id = getattr(request.state, "request_id", str(uuid.uuid4()))
        code = infer_error_code(exc.status_code, exc.detail).value
        message = _extract_http_exception_message(exc.detail)
        details = exc.detail if isinstance(exc.detail, (dict, list)) else None
        retryable = exc.status_code in (502, 503, 504)
        payload = ErrorPayload(
            code=code,
            message=message,
            details=details,
            request_id=request_id,
            retryable=retryable,
        )
        return _json_error_response(exc.status_code, payload)

    @app.exception_handler(RequestValidationError)
    async def request_validation_handler(request: Request, exc: RequestValidationError):
        request_id = getattr(request.state, "request_id", str(uuid.uuid4()))
        payload = ErrorPayload(
            code=status_to_error_code(422).value,
            message="Request validation failed",
            details=exc.errors(),
            request_id=request_id,
            retryable=False,
        )
        return _json_error_response(422, payload)

    @app.exception_handler(Exception)
    async def unhandled_exception_handler(request: Request, exc: Exception):
        logger.exception("Unhandled exception: %s", exc)
        request_id = getattr(request.state, "request_id", str(uuid.uuid4()))
        payload = ErrorPayload(
            code=status_to_error_code(500).value,
            message="Internal server error",
            details=None,
            request_id=request_id,
            retryable=True,
        )
        return _json_error_response(500, payload)

    # CORS middleware
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
    )

    # Include routers
    app.include_router(auth.router, prefix="/auth", tags=["authentication"])
    app.include_router(tenants.router, prefix="/tenants", tags=["tenants"])
    app.include_router(proxy.router, prefix="/proxy", tags=["proxy"])
    app.include_router(sheet.router, prefix="/sheet", tags=["sheet"])
    app.include_router(admin.router, prefix="/admin", tags=["admin"])
    app.include_router(reports.router, prefix="/reports", tags=["reports"])
    app.include_router(models.router, prefix="", tags=["models"])
    app.include_router(ws.router, tags=["ws"])
    app.include_router(analytics.router, prefix="", tags=["analytics"])
    app.include_router(openai_images.router, prefix="", tags=["openai-images"])
    app.include_router(payments.router, prefix="/payments", tags=["payments"])
    app.include_router(feedback.router, prefix="", tags=["feedback"])

    @app.get("/")
    async def redirect_to_trending():
        return RedirectResponse(url="/reports/trending")

    def _check_database_sync() -> bool:
        if not settings.is_database_storage():
            return True
        if db_engine is None:
            return False
        try:
            with db_engine.connect() as conn:
                conn.execute(text("SELECT 1"))
            return True
        except Exception:
            return False

    def _check_redis_sync() -> bool:
        try:
            client = Redis.from_url(settings.redis_url)
            return bool(client.ping())
        except Exception:
            return False

    async def _check_runninghub() -> bool:
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.get(f"{settings.runninghub_service_url}/health")
            return resp.status_code == 200
        except Exception:
            return False

    async def _dependency_checks() -> dict:
        database_ok = await asyncio.to_thread(_check_database_sync)
        redis_ok = await asyncio.to_thread(_check_redis_sync)
        runninghub_ok = await _check_runninghub()
        return {
            "database": database_ok,
            "redis": redis_ok,
            "runninghub": runninghub_ok,
        }

    @app.get("/health")
    async def health_check():
        checks = await _dependency_checks()
        healthy = all(checks.values())
        payload = {
            "status": "healthy" if healthy else "unhealthy",
            "service": "tenant-service",
            "checks": checks,
        }
        return JSONResponse(content=payload, status_code=200 if healthy else 503)

    @app.get("/ready")
    async def readiness_check():
        checks = await _dependency_checks()
        ready = all(checks.values())
        payload = {
            "ready": ready,
            "service": "tenant-service",
            "checks": checks,
        }
        return JSONResponse(content=payload, status_code=200 if ready else 503)

    @app.on_event("startup")
    async def sync_thumbnails_on_startup():
        logger.info("同步缩略图目录状态")
        image_storage_service.sync_all_thumbnails()
        running_tasks_monitor.start()
        report_auto_converter.start()
        database_backup_scheduler.start()

    @app.on_event("shutdown")
    async def shutdown_autorun_tasks():
        await running_tasks_monitor.stop()
        await report_auto_converter.stop()
        await database_backup_scheduler.stop()
    
    logger.info("多租户微服务配置完成")
    return app

app = create_app()
