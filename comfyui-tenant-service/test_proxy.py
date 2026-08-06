#!/usr/bin/env python3
"""
测试多租户服务器代理功能的脚本
"""
import requests
import json

# 配置
TENANT_API_BASE = "http://localhost:8081"
BACKEND_API_BASE = "http://localhost:8080"

def test_direct_backend():
    """直接测试后端服务"""
    print("=== 直接测试后端服务 ===")
    
    # 创建测试文件
    test_content = b"test image content for proxy test"
    files = {
        "file": ("test_proxy.jpg", test_content, "image/jpeg")
    }
    data = {
        "fileType": "image"
    }
    
    try:
        response = requests.post(
            f"{BACKEND_API_BASE}/v1/upload",
            files=files,
            data=data,
            timeout=30
        )
        print(f"后端直接请求状态: {response.status_code}")
        if response.status_code == 200:
            result = response.json()
            print(f"后端直接请求成功: {result}")
            return result.get("fileName")
        else:
            print(f"后端直接请求失败: {response.text}")
            return None
    except Exception as e:
        print(f"后端直接请求异常: {e}")
        return None

def test_tenant_proxy():
    """测试多租户服务器代理"""
    print("\n=== 测试多租户服务器代理 ===")
    
    # 1. 先登录获取token
    print("1. 登录获取token...")
    login_data = {
        "username": "testuser",
        "password": "testpass123"
    }
    
    try:
        login_response = requests.post(
            f"{TENANT_API_BASE}/auth/token",
            data=login_data,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            timeout=30
        )
        print(f"登录响应状态: {login_response.status_code}")
        
        if login_response.status_code != 200:
            print(f"登录失败: {login_response.text}")
            return
        
        token_data = login_response.json()
        token = token_data.get("access_token")
        print(f"获取到token: {token[:20]}..." if token else "No token")
        
    except Exception as e:
        print(f"登录异常: {e}")
        return
    
    # 2. 测试代理上传
    print("\n2. 测试代理上传...")
    test_content = b"test image content for proxy test"
    files = {
        "file": ("test_proxy.jpg", test_content, "image/jpeg")
    }
    data = {
        "fileType": "image"
    }
    headers = {
        "Authorization": f"Bearer {token}"
    }
    
    try:
        response = requests.post(
            f"{TENANT_API_BASE}/proxy/upload",
            files=files,
            data=data,
            headers=headers,
            timeout=30
        )
        print(f"代理请求状态: {response.status_code}")
        print(f"代理响应头: {dict(response.headers)}")
        
        if response.status_code == 200:
            result = response.json()
            print(f"代理请求成功: {result}")
        else:
            print(f"代理请求失败: {response.text}")
            
    except Exception as e:
        print(f"代理请求异常: {e}")

if __name__ == "__main__":
    # 先测试后端服务
    backend_result = test_direct_backend()
    
    # 再测试代理
    test_tenant_proxy()

