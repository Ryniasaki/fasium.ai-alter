#!/usr/bin/env python
"""
Convert PDF buyer reports into Markdown + HTML summaries and maintain an index JSON.

Usage:
    python scripts/convert_reports.py --overwrite
"""

from __future__ import annotations

import argparse
import sys

from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from app.services.report_converter import convert_reports


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Convert PDF reports into Markdown/HTML deliverables.")
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Regenerate outputs even if they are newer than the PDF source.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Only process the first N PDFs (sorted alphabetically).",
    )
    parser.add_argument(
        "--only-missing",
        action="store_true",
        help="Only convert PDFs that are not yet present in report_index.json.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    records = convert_reports(
        overwrite=args.overwrite,
        limit=args.limit,
        only_missing=args.only_missing,
    )
    if records:
        print(f"[✓] Generated {len(records)} report(s).")
    else:
        print("[i] No reports needed regeneration.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
