from __future__ import annotations

import re
import uuid
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

from .config import get_settings

settings = get_settings()


def _is_markdown_path(value: str) -> bool:
    trimmed = value.strip()
    if not trimmed:
        return False
    if "\n" in trimmed or "\r" in trimmed:
        return False
    return trimmed.lower().endswith(".md")


def _sanitize_filename(value: str) -> str:
    if not value:
        return uuid.uuid4().hex
    safe = re.sub(r"[^a-zA-Z0-9._-]+", "_", value.strip())
    return safe.strip("._-") or uuid.uuid4().hex


def _build_markdown_with_images(markdown: str, sketches: Dict[str, Any]) -> str:
    if not isinstance(sketches, dict):
        return markdown

    image_entries: List[Tuple[str, str]] = []
    reference_url = sketches.get("referenceUrl")
    tri_view_url = sketches.get("triViewUrl")
    annotated_url = sketches.get("annotatedSketchUrl")

    if isinstance(reference_url, str) and reference_url.strip():
        image_entries.append(("Reference", reference_url.strip()))
    if isinstance(tri_view_url, str) and tri_view_url.strip():
        image_entries.append(("Tri-view", tri_view_url.strip()))
    if isinstance(annotated_url, str) and annotated_url.strip():
        image_entries.append(("Annotated Sketch", annotated_url.strip()))

    if not image_entries:
        return markdown

    missing = [(label, url) for label, url in image_entries if url not in markdown]
    if not missing:
        return markdown

    if len(missing) == 1:
        label, url = missing[0]
        header = f"![{label}]({url})"
    else:
        labels = [label for label, _ in missing]
        header = "| " + " | ".join(labels) + " |"
        divider = "| " + " | ".join(["---"] * len(labels)) + " |"
        row = "| " + " | ".join([f"![{label}]({url})" for label, url in missing]) + " |"
        header = "\n".join([header, divider, row])

    if markdown.strip():
        return f"{header}\n\n{markdown}"
    return header


def _iter_sheet_assets(content: Dict[str, Any]) -> Iterable[Dict[str, Any]]:
    board = content.get("board")
    if not isinstance(board, dict):
        return []
    assets = board.get("canvasAssets")
    if not isinstance(assets, list):
        return []
    return [asset for asset in assets if isinstance(asset, dict) and asset.get("type") == "sheet"]


def persist_sheet_markdown(
    content: Dict[str, Any],
    user_id: Optional[str],
    project_id: Optional[str],
) -> Dict[str, Any]:
    if not isinstance(content, dict):
        return content

    username = (user_id or "").strip()
    if not username:
        return content

    output_root = Path(settings.output_storage_path).resolve()
    markdown_dir = output_root / username / "markdown"
    markdown_dir.mkdir(parents=True, exist_ok=True)

    for asset in _iter_sheet_assets(content):
        sheet_data = asset.get("sheetData")
        if not isinstance(sheet_data, dict):
            continue
        report_markdown = sheet_data.get("reportMarkdown")
        if not isinstance(report_markdown, str) or not report_markdown.strip():
            continue
        if _is_markdown_path(report_markdown):
            continue

        report_markdown = _build_markdown_with_images(report_markdown, sheet_data.get("sketches") or {})
        asset_id = _sanitize_filename(str(asset.get("id") or uuid.uuid4().hex))
        project_part = _sanitize_filename(str(project_id or "project"))
        filename = f"{project_part}-{asset_id}.md"
        full_path = markdown_dir / filename
        full_path.write_text(report_markdown, encoding="utf-8")

        relative_path = Path("output") / username / "markdown" / filename
        sheet_data["reportMarkdown"] = relative_path.as_posix()
        asset["sheetData"] = sheet_data

    return content
