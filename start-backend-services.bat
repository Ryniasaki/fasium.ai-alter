@echo off
echo 正在停止端口8000和8081上的应用...

REM 杀死8000端口的应用
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :8000') do (
    echo 正在杀死端口8000上的进程 %%a
    taskkill /f /pid %%a >nul 2>&1
)

REM 杀死8081端口的应用
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :8081') do (
    echo 正在杀死端口8081上的进程 %%a
    taskkill /f /pid %%a >nul 2>&1
)

echo 端口清理完成
echo.

echo 正在启动comfyui-tenant-service...
start "ComfyUI Tenant Service" cmd /k "cd /d comfyui-tenant-service && start.bat"

echo 等待2秒后启动comfyui-runninghub...
timeout /t 2 /nobreak >nul

echo 正在启动comfyui-runninghub...
start "ComfyUI RunningHub" cmd /k "cd /d comfyui-runninghub && start.bat"

echo.
echo 所有服务已启动完成！
echo 请检查新打开的窗口以确认服务正常运行。
