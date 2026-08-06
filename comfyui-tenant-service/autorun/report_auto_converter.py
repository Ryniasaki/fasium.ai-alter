from __future__ import annotations

import asyncio
from typing import Optional

from app.services.logger import get_main_logger
from app.services.report_converter import ReportConverter


class ReportAutoConverter:
    """Background job to keep PDF ↔ HTML mapping fresh."""

    def __init__(self, interval_hours: int = 24):
        self.interval_seconds = interval_hours * 3600
        self._task: Optional[asyncio.Task] = None
        self._logger = get_main_logger()
        self._converter = ReportConverter()

    def start(self) -> None:
        if self._task and not self._task.done():
            return
        if not self._converter.llm_client.is_configured():
            self._logger.warning("ReportAutoConverter: LLM 未配置，跳过自动转换。")
            return
        self._logger.info("ReportAutoConverter: 启动自动报告转换任务。")
        self._task = asyncio.create_task(self._run_loop())

    async def stop(self) -> None:
        if self._task and not self._task.done():
            self._logger.info("ReportAutoConverter: 停止自动报告转换任务。")
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        self._task = None

    async def _run_loop(self) -> None:
        await self._run_once(initial=True)
        while True:
            await asyncio.sleep(self.interval_seconds)
            await self._run_once(initial=False)

    async def _run_once(self, *, initial: bool) -> None:
        try:
            results = await asyncio.to_thread(
                self._converter.convert_all,
                False,
                None,
                True,
            )
            if results:
                self._logger.info(
                    "ReportAutoConverter: %s转换了 %s 份报告。",
                    "启动时" if initial else "定时任务",
                    len(results),
                )
            else:
                self._logger.info(
                    "ReportAutoConverter: %s无新增报告需要转换。",
                    "启动时" if initial else "定时任务",
                )
        except FileNotFoundError:
            self._logger.warning(
                "ReportAutoConverter: 未找到 PDF 目录 %s，稍后重试。",
                self._converter.pdf_dir,
            )
        except Exception as exc:  # pylint: disable=broad-except
            self._logger.error("ReportAutoConverter: 转换失败: %s", exc)


report_auto_converter = ReportAutoConverter()
