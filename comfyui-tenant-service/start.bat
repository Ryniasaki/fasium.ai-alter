@echo off
chcp 65001 >nul
echo ========================================
echo Start ComfyUI Tenant Service
echo ========================================
echo.

REM Check if Python is installed
python --version >nul 2>&1
if errorlevel 1 (
    echo Error: Python not found, please install Python 3.9+
    pause
    exit /b 1
)

echo Check virtual environment...
if not exist ".venv\Scripts\activate.bat" (
    echo Create virtual environment...
    python -m venv .venv
    if errorlevel 1 (
        echo Error: Failed to create virtual environment
        pause
        exit /b 1
    )
    echo Virtual environment created successfully!
    echo.
    echo Install dependencies...
    call .venv\Scripts\activate.bat
    .venv\Scripts\pip install -r requirements.txt
    if errorlevel 1 (
        echo Error: Failed to install dependencies
        pause
        exit /b 1
    )
    echo Dependencies installed successfully!
) else (
    echo Virtual environment exists, activating...
    call .venv\Scripts\activate.bat
)

echo.
echo ========================================
echo Start Tenant Service
echo ========================================
echo Access URL: http://localhost:8081
echo API Docs: http://localhost:8081/docs
echo Press Ctrl+C to stop server
echo ========================================
echo.

.venv\Scripts\uvicorn app.main:app --reload --host 0.0.0.0 --port 8081

echo.
echo Server stopped
pause
