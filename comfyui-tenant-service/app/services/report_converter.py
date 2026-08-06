from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

import pdfplumber

from .config import get_settings
from .llm_client import LLMClient, LLMClientError
from .logger import get_main_logger


ISO_TIMESTAMP = "%Y-%m-%dT%H:%M:%SZ"
DATE_FORMAT = "%Y-%m-%d"


@dataclass
class TableData:
    page: int
    headers: List[str]
    rows: List[Dict[str, str]]


@dataclass
class ChartData:
    title: str
    chart_type: str
    description: str
    data_points: List[Dict[str, Any]]


class ReportConverter:
    """Convert PDF reports into Markdown/HTML summaries with LLM assistance."""

    def __init__(
        self,
        pdf_dir: Optional[Path] = None,
        output_dir: Optional[Path] = None,
        index_file: Optional[Path] = None,
    ) -> None:
        settings = get_settings()
        base_report_dir = Path(settings.json_storage_path).resolve() / "report"
        self.repo_root = Path(__file__).resolve().parents[2]
        self.pdf_dir = pdf_dir or base_report_dir / "pdf"
        self.output_dir = output_dir or base_report_dir / "html"
        self.index_file = index_file or (base_report_dir / "report_index.json")
        self.logger = get_main_logger()
        self.llm_client = LLMClient()

    def convert_all(
        self,
        overwrite: bool = False,
        limit: Optional[int] = None,
        only_missing: bool = False,
    ) -> List[Dict[str, Any]]:
        if not self.pdf_dir.exists():
            raise FileNotFoundError(f"PDF directory not found: {self.pdf_dir}")

        self.output_dir.mkdir(parents=True, exist_ok=True)
        pdf_files = sorted(self.pdf_dir.glob("*.pdf"))
        if limit is not None:
            pdf_files = pdf_files[:limit]

        indexed = self._load_indexed_reports()
        results: List[Dict[str, Any]] = []
        for pdf_path in pdf_files:
            relative_pdf = str(pdf_path.relative_to(self.repo_root).as_posix())
            if only_missing and relative_pdf in indexed:
                continue
            try:
                entry = self.convert_single(pdf_path, overwrite=overwrite)
            except LLMClientError as exc:
                self.logger.error("LLM summary failed for %s: %s", pdf_path.name, exc)
                continue
            except Exception as exc:  # pragma: no cover - defensive fallback
                self.logger.error("Failed to convert %s: %s", pdf_path.name, exc)
                continue
            if entry:
                results.append(entry)

        if results:
            self._update_index(results)
        return results

    def convert_single(self, pdf_path: Path, overwrite: bool = False) -> Optional[Dict[str, Any]]:
        if not pdf_path.exists():
            self.logger.warning("PDF not found: %s", pdf_path)
            return None

        base_name = pdf_path.stem
        markdown_path = self.output_dir / f"{base_name}.md"

        if (
            not overwrite
            and markdown_path.exists()
            and markdown_path.stat().st_mtime >= pdf_path.stat().st_mtime
        ):
            self.logger.info("Skipping %s because outputs are newer than PDF.", pdf_path.name)
            return None

        pages_text, tables = self._extract_pdf(pdf_path)
        summary = self._request_summary(pdf_path.name, pages_text, tables)
        headline = summary.get("headline") or f"{base_name} 摘要"
        markdown_summary = summary.get("markdown_summary") or "_摘要生成失败。_"
        charts = self._parse_charts(summary.get("charts", []))

        timestamp = datetime.now(timezone.utc).strftime(ISO_TIMESTAMP)
        source_mtime = datetime.fromtimestamp(pdf_path.stat().st_mtime, tz=timezone.utc).strftime(ISO_TIMESTAMP)
        data_points_markdown = self._render_chart_lists(charts)

        markdown_doc = self._build_markdown_document(
            headline=headline,
            markdown_body=markdown_summary,
            data_points_block=data_points_markdown,
            generated_at=timestamp,
        )

        markdown_path.write_text(markdown_doc, encoding="utf-8")

        self.logger.info("Generated Markdown for %s", pdf_path.name)
        relative_pdf = str(pdf_path.relative_to(self.repo_root).as_posix())
        relative_markdown = str(markdown_path.relative_to(self.repo_root).as_posix())
        return {
            "pdf": relative_pdf,
            "markdown": relative_markdown,
            "headline": headline,
            "generated_at": timestamp,
            "source_mtime": source_mtime,
            "table_count": len(tables),
        }

    def _extract_pdf(self, pdf_path: Path) -> tuple[List[Dict[str, Any]], List[TableData]]:
        pages: List[Dict[str, Any]] = []
        tables: List[TableData] = []
        with pdfplumber.open(pdf_path) as pdf:
            for page_index, page in enumerate(pdf.pages, start=1):
                text = page.extract_text() or ""
                pages.append({"page": page_index, "text": text.strip()})
                try:
                    extracted_tables = page.extract_tables() or []
                except Exception:  # pragma: no cover - pdfplumber internal errors
                    extracted_tables = []
                for table in extracted_tables:
                    normalized = self._normalize_table(table)
                    if normalized:
                        tables.append(TableData(page=page_index, headers=normalized["headers"], rows=normalized["rows"]))
        return pages, tables

    def _normalize_table(self, table: List[List[Optional[str]]]) -> Optional[Dict[str, Any]]:
        if not table or not any(row for row in table):
            return None

        header_row = table[0]
        headers: List[str] = []
        for idx, cell in enumerate(header_row):
            header = (cell or "").strip()
            headers.append(header if header else f"Column {idx + 1}")

        rows: List[Dict[str, str]] = []
        for raw_row in table[1:]:
            row_dict: Dict[str, str] = {}
            for idx, header in enumerate(headers):
                value = ""
                if idx < len(raw_row):
                    cell = raw_row[idx]
                    value = (cell or "").strip()
                row_dict[header] = value
            if any(value for value in row_dict.values()):
                rows.append(row_dict)

        if not rows:
            return None
        return {"headers": headers, "rows": rows}

    def _request_summary(
        self,
        pdf_name: str,
        pages_text: List[Dict[str, Any]],
        tables: List[TableData],
    ) -> Dict[str, Any]:
        excerpt = self._build_text_excerpt(pages_text)
        table_context = self._build_table_context(tables)
        prompt = (
            "你是时尚买手报告分析专家。基于提供的文字摘录与表格信息，总结关键洞察并挑选最重要的"
            "数字用于统计图表，帮助管理层直观理解趋势。回答要求："
            "1) headline - 简洁的中文标题；"
            "2) markdown_summary - Markdown 正文，使用段落和列表呈现洞察，不要提数据来源说明；"
            "3) charts - 数组，每项包含 title, chart_type(bar|line|pie等), description 以及 data_points "
            "(含 label 和 value)。每个图表必须引用表格中的数字。"
            "输出 JSON，必须可被直接解析。"
            "\n\n文件名: {pdf_name}\n"
            "## 文字摘要\n{excerpt}\n"
            "## 表格数据(最多 5 个)\n{table_json}\n"
        ).format(pdf_name=pdf_name, excerpt=excerpt or "（无可用文字）", table_json=json.dumps(table_context, ensure_ascii=False))

        messages = [
            {
                "role": "system",
                "content": "You are an experienced fashion industry analyst. Always return valid JSON.",
            },
            {"role": "user", "content": prompt},
        ]
        return self.llm_client.chat_json(
            messages,
            response_format={"type": "json_object"},
            temperature=0.1,
            max_output_tokens=1200,
        )

    def _build_text_excerpt(self, pages_text: List[Dict[str, Any]], limit: int = 4000) -> str:
        chunks: List[str] = []
        consumed = 0
        for entry in pages_text:
            text = entry.get("text") or ""
            if not text:
                continue
            prefix = f"[Page {entry.get('page')}] "
            snippet = f"{prefix}{text.strip()}"
            if not snippet:
                continue
            remaining = max(limit - consumed, 0)
            if remaining <= 0:
                break
            chunks.append(snippet[:remaining])
            consumed += min(len(snippet), remaining)
        return "\n\n".join(chunks)

    def _build_table_context(self, tables: List[TableData], max_tables: int = 5, max_rows: int = 10) -> List[Dict[str, Any]]:
        context: List[Dict[str, Any]] = []
        for table in tables[:max_tables]:
            context.append(
                {
                    "page": table.page,
                    "headers": table.headers,
                    "rows": table.rows[:max_rows],
                }
            )
        return context

    def _build_markdown_document(
        self,
        headline: str,
        markdown_body: str,
        data_points_block: str,
        generated_at: str,
    ) -> str:
        generated_date = self._format_iso_date(generated_at)
        return "\n".join(
            [
                f"# {headline}",
                "",
                f"- 报告生成日期: {generated_date}",
                "",
                "## 摘要",
                markdown_body,
                "",
                "## 数据列表",
                data_points_block,
                "",
            ]
        )

    def _update_index(self, records: List[Dict[str, Any]]) -> None:
        existing: Dict[str, Any] = {
            "generated_at": datetime.now(timezone.utc).strftime(ISO_TIMESTAMP),
            "reports": [],
        }
        if self.index_file.exists():
            try:
                existing = json.loads(self.index_file.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                self.logger.warning("Existing index file无法解析，将重新生成: %s", self.index_file)
        indexed: Dict[str, Dict[str, Any]] = {
            entry.get("pdf"): entry for entry in existing.get("reports", []) if isinstance(entry, dict)
        }
        for record in records:
            indexed[record["pdf"]] = record
        new_payload = {
            "generated_at": datetime.now(timezone.utc).strftime(ISO_TIMESTAMP),
            "reports": list(indexed.values()),
        }
        self.index_file.parent.mkdir(parents=True, exist_ok=True)
        self.index_file.write_text(json.dumps(new_payload, ensure_ascii=False, indent=2), encoding="utf-8")
        self.logger.info("报告索引已更新: %s", self.index_file)

    def _parse_charts(self, charts_payload: Any) -> List[ChartData]:
        parsed: List[ChartData] = []
        if not isinstance(charts_payload, list):
            return parsed
        for entry in charts_payload:
            if not isinstance(entry, dict):
                continue
            title = (entry.get("title") or "").strip()
            chart_type = (entry.get("chart_type") or "bar").strip().lower()
            description = (entry.get("description") or "").strip()
            data_points = entry.get("data_points") if isinstance(entry.get("data_points"), list) else []
            formatted_points: List[Dict[str, Any]] = []
            for point in data_points:
                if isinstance(point, dict) and "label" in point and "value" in point:
                    formatted_points.append({"label": point["label"], "value": point["value"]})
            if not title or not formatted_points:
                continue
            parsed.append(
                ChartData(
                    title=title,
                    chart_type=chart_type or "bar",
                    description=description,
                    data_points=formatted_points,
                )
            )
        return parsed

    def _render_chart_lists(self, charts: List[ChartData]) -> str:
        if not charts:
            return "_暂无图表建议。_"
        blocks: List[str] = []
        for index, chart in enumerate(charts, start=1):
            lines = [
                f"### 列表 {index}: {chart.title}",
                chart.description or "",
            ]
            for point in chart.data_points:
                lines.append(f"- {point['label']}: {point['value']}")
            blocks.append("\n".join(lines))
        return "\n\n".join(blocks)

    def _format_iso_date(self, value: str) -> str:
        if not value:
            return ""
        cleaned = value.replace("Z", "+00:00")
        try:
            dt = datetime.fromisoformat(cleaned)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.astimezone(timezone.utc).strftime(DATE_FORMAT)
        except ValueError:
            return value.split("T")[0]

    def _load_indexed_reports(self) -> Dict[str, Dict[str, Any]]:
        if not self.index_file.exists():
            return {}
        try:
            payload = json.loads(self.index_file.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            self.logger.warning("索引文件内容损坏，将重新生成: %s", self.index_file)
            return {}
        reports = payload.get("reports", [])
        indexed: Dict[str, Dict[str, Any]] = {}
        if isinstance(reports, list):
            for entry in reports:
                if isinstance(entry, dict) and entry.get("pdf"):
                    indexed[entry["pdf"]] = entry
        return indexed


def convert_reports(
    overwrite: bool = False,
    limit: Optional[int] = None,
    only_missing: bool = False,
) -> List[Dict[str, Any]]:
    """Helper for scripts."""
    converter = ReportConverter()
    return converter.convert_all(overwrite=overwrite, limit=limit, only_missing=only_missing)
