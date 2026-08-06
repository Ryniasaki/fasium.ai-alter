"""
工作流管理器
负责管理和执行不同的工作流
"""
from typing import Dict, Any, List, Type
from abc import ABC, abstractmethod
import importlib
import os
from pydantic import BaseModel
from app.services.logger import get_main_logger

logger = get_main_logger()

class Workflow(ABC):
    """工作流基类"""
    
    @property
    @abstractmethod
    def webapp_id(self) -> str:
        """返回工作流的 webapp ID"""
        pass
    
    @property
    @abstractmethod
    def name(self) -> str:
        """返回工作流名称"""
        pass
    
    @property
    @abstractmethod
    def display_name(self) -> str:
        """返回工作流显示名称"""
        pass
    
    @property
    @abstractmethod
    def description(self) -> str:
        """返回工作流描述"""
        pass
    
    @property
    @abstractmethod
    def input_model(self) -> Type[BaseModel]:
        """返回工作流的输入参数模型"""
        pass
    
    @abstractmethod
    def get_node_info_list(self, **kwargs) -> List[Dict[str, Any]]:
        """根据参数生成节点信息列表"""
        pass
    
    async def execute_workflow(self, **kwargs) -> Dict[str, Any]:
        """执行工作流（可选，用于需要异步执行的工作流）"""
        # 默认实现，子类可以重写
        return {"message": "工作流执行完成"}

class WorkflowManager:
    """工作流管理器"""
    
    def __init__(self):
        self.workflows: Dict[str, Workflow] = {}
        self._load_workflows()
    
    def _load_workflows(self):
        """动态加载所有工作流"""
        workflows_dir = os.path.dirname(__file__)
        
        for filename in os.listdir(workflows_dir):
            if filename.endswith('.py') and filename != '__init__.py' and filename != 'workflow_manager.py':
                module_name = filename[:-3]  # 移除 .py 扩展名
                try:
                    module = importlib.import_module(f'workflows.{module_name}')
                    
                    # 查找工作流类
                    for attr_name in dir(module):
                        attr = getattr(module, attr_name)
                        if (isinstance(attr, type) and 
                            issubclass(attr, Workflow) and 
                            attr != Workflow):
                            
                            workflow_instance = attr()
                            self.workflows[workflow_instance.name] = workflow_instance
                            logger.info(f"加载工作流: {workflow_instance.name} - {workflow_instance.display_name}")
                            
                except Exception as e:
                    logger.error(f"加载工作流 {module_name} 失败: {str(e)}")
    
    def get_workflow(self, name: str) -> Workflow:
        """获取指定名称的工作流"""
        if name not in self.workflows:
            raise ValueError(f"工作流 '{name}' 不存在")
        return self.workflows[name]
    
    def list_workflows(self) -> List[Dict[str, Any]]:
        """列出所有可用的工作流及其信息"""
        return [
            {
                "name": workflow.name,
                "display_name": workflow.display_name,
                "description": workflow.description,
                "input_model": {
                    field_name: {
                        "type": str(field_info.annotation),
                        "default": field_info.default if field_info.default is not None else None,
                        "description": field_info.description if hasattr(field_info, 'description') else None
                    }
                    for field_name, field_info in workflow.input_model.model_fields.items()
                }
            }
            for workflow in self.workflows.values()
        ]
    
    def execute_workflow(self, name: str, **kwargs) -> Dict[str, Any]:
        """执行指定的工作流"""
        workflow = self.get_workflow(name)
        node_info_list = workflow.get_node_info_list(**kwargs)
        
        return {
            "webapp_id": workflow.webapp_id,
            "node_info_list": node_info_list,
            "workflow_name": workflow.name
        }
    
    async def execute_workflow_async(self, name: str, **kwargs) -> Dict[str, Any]:
        """异步执行指定的工作流"""
        workflow = self.get_workflow(name)
        
        # 检查工作流是否有自定义的异步执行方法
        if hasattr(workflow, 'execute_workflow'):
            return await workflow.execute_workflow(**kwargs)
        else:
            # 使用默认的同步执行方法
            node_info_list = workflow.get_node_info_list(**kwargs)
            return {
                "webapp_id": workflow.webapp_id,
                "node_info_list": node_info_list,
                "workflow_name": workflow.name
            }
    
    def get_workflow_input_model(self, name: str) -> Type[BaseModel]:
        """获取工作流的输入参数模型"""
        workflow = self.get_workflow(name)
        return workflow.input_model

# 全局工作流管理器实例
workflow_manager = WorkflowManager()
