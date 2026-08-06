import logging
import os
from datetime import datetime
from pathlib import Path


class ServiceLogger:
    def __init__(self, service_name: str):
        self.service_name = service_name
        self.log_dir = Path("logs") / service_name
        self.log_dir.mkdir(parents=True, exist_ok=True)
        
        # 创建按小时分割的日志文件名
        now = datetime.now()
        log_filename = f"{now.strftime('%Y%m%d%H')}.log"
        log_path = self.log_dir / log_filename
        
        # 配置日志
        self.logger = logging.getLogger(f"{service_name}_{now.strftime('%Y%m%d%H')}")
        self.logger.setLevel(logging.DEBUG)
        
        # 避免重复添加handler
        if not self.logger.handlers:
            handler = logging.FileHandler(log_path, encoding='utf-8')
            formatter = logging.Formatter(
                '%(asctime)s - %(name)s - %(levelname)s - %(message)s',
                datefmt='%Y-%m-%d %H:%M:%S'
            )
            handler.setFormatter(formatter)
            self.logger.addHandler(handler)
    
    def debug(self, message: str):
        self.logger.debug(message)
    
    def info(self, message: str):
        self.logger.info(message)
    
    def warning(self, message: str):
        self.logger.warning(message)
    
    def error(self, message: str):
        self.logger.error(message)


# 创建各个服务的日志器
def get_runninghub_logger():
    return ServiceLogger("runninghub_client")

def get_task_manager_logger():
    return ServiceLogger("task_manager")

def get_router_logger():
    return ServiceLogger("router")

def get_main_logger():
    return ServiceLogger("main")
