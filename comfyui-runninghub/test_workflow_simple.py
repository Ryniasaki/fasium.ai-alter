#!/usr/bin/env python3
"""
简单的工作流测试脚本
"""
import sys
import os

# 添加项目根目录到 Python 路径
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

try:
    from workflows.workflow_manager import workflow_manager
    
    print("=== 工作流管理器测试 ===")
    print(f"可用工作流: {workflow_manager.list_workflows()}")
    
    # 测试国潮纸雕工作流
    if 'guochao_papercut' in workflow_manager.list_workflows():
        print("\n=== 测试国潮纸雕工作流 ===")
        config = workflow_manager.execute_workflow(
            'guochao_papercut',
            prompt="一个美丽的女孩，长发，微笑",
            height=1536,
            width=1024
        )
        print(f"工作流配置: {config}")
    else:
        print("国潮纸雕工作流未找到")
        
except Exception as e:
    print(f"测试失败: {e}")
    import traceback
    traceback.print_exc()
