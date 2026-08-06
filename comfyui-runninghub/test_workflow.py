#!/usr/bin/env python3
"""
测试工作流系统
"""
import sys
import os
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from workflows.workflow_manager import workflow_manager

def test_workflow_manager():
    """测试工作流管理器"""
    print("=== 测试工作流管理器 ===")
    
    # 列出所有工作流
    workflows = workflow_manager.list_workflows()
    print(f"可用工作流: {workflows}")
    
    # 测试国潮纸雕工作流
    if 'guochao_papercut' in workflows:
        print("\n=== 测试国潮纸雕工作流 ===")
        config = workflow_manager.execute_workflow(
            'guochao_papercut',
            prompt="一个美丽的女孩，长发，微笑",
            height=1536,
            width=1024
        )
        
        print(f"工作流配置:")
        print(f"  webapp_id: {config['webapp_id']}")
        print(f"  workflow_name: {config['workflow_name']}")
        print(f"  node_info_list: {config['node_info_list']}")
        
        # 验证节点信息
        node_info = config['node_info_list']
        assert len(node_info) == 3, f"应该有3个节点，实际有{len(node_info)}个"
        
        # 检查文本节点
        text_node = next((n for n in node_info if n['nodeId'] == '6'), None)
        assert text_node is not None, "缺少文本节点"
        assert "国潮纸雕艺术风格" in text_node['fieldValue'], "提示词应该包含国潮纸雕艺术风格"
        assert "一个美丽的女孩" in text_node['fieldValue'], "提示词应该包含用户输入"
        
        # 检查尺寸节点
        height_node = next((n for n in node_info if n['nodeId'] == '58' and n['fieldName'] == 'height'), None)
        width_node = next((n for n in node_info if n['nodeId'] == '58' and n['fieldName'] == 'width'), None)
        
        assert height_node is not None, "缺少高度节点"
        assert width_node is not None, "缺少宽度节点"
        assert height_node['fieldValue'] == '1536', f"高度应该是1536，实际是{height_node['fieldValue']}"
        assert width_node['fieldValue'] == '1024', f"宽度应该是1024，实际是{width_node['fieldValue']}"
        
        print("✅ 国潮纸雕工作流测试通过")
    else:
        print("❌ 未找到国潮纸雕工作流")
    
    print("\n=== 测试完成 ===")

if __name__ == "__main__":
    test_workflow_manager()
