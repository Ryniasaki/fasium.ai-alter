from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse
from starlette.datastructures import UploadFile as StarletteUploadFile

from ..models.database import get_db
from ..routers.auth import get_current_user
from ..services.openai_image_provider import (
    ImageProviderError,
    openai_image_provider_service,
)


router = APIRouter()


def _parse_response_format(value: Any) -> str:
    response_format = str(value or "url").strip()
    if response_format not in {"url", "b64_json"}:
        raise HTTPException(status_code=400, detail="response_format must be 'url' or 'b64_json'")
    return response_format


def _extract_uploads_from_form(form: Any, field_name: str = "image") -> List[UploadFile]:
    uploads: List[UploadFile] = []
    getlist = getattr(form, "getlist", None)
    if callable(getlist):
        for value in getlist(field_name):
            if isinstance(value, (UploadFile, StarletteUploadFile)):
                uploads.append(value)
    single = form.get(field_name)
    if isinstance(single, (UploadFile, StarletteUploadFile)) and all(single is not item for item in uploads):
        uploads.append(single)
    return uploads


@router.post("/v1/images/generations")
async def openai_image_generations(
    request: Request,
    current_user=Depends(get_current_user),
    db=Depends(get_db),
) -> JSONResponse:
    payload = await request.json()
    prompt = payload.get("prompt")
    if not isinstance(prompt, str) or not prompt.strip():
        raise HTTPException(status_code=400, detail="prompt is required")
    if int(payload.get("n", 1)) != 1:
        raise HTTPException(status_code=400, detail="Only n=1 is supported")

    response_format = _parse_response_format(payload.get("response_format"))
    try:
        response = await openai_image_provider_service.generate(
            request=request,
            current_user=current_user,
            prompt=prompt.strip(),
            response_format=response_format,
            model=payload.get("model"),
        )
    except ImageProviderError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return JSONResponse(response)


@router.post("/v1/images/edits")
async def openai_image_edits(
    request: Request,
    current_user=Depends(get_current_user),
    db=Depends(get_db),
) -> JSONResponse:
    form = await request.form()
    prompt = str(form.get("prompt") or "").strip()
    if not prompt:
        raise HTTPException(status_code=400, detail="prompt is required")

    try:
        n_value = int(form.get("n", 1))
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="n must be an integer")
    if n_value != 1:
        raise HTTPException(status_code=400, detail="Only n=1 is supported")

    response_format = _parse_response_format(form.get("response_format"))
    image_uploads = _extract_uploads_from_form(form, "image")
    if not image_uploads:
        raise HTTPException(status_code=400, detail="At least one image is required")

    images: List[Tuple[str, bytes, str]] = []
    for upload in image_uploads:
        file_bytes = await upload.read()
        if not file_bytes:
            raise HTTPException(status_code=400, detail=f"Uploaded image is empty: {upload.filename or 'image'}")
        images.append(
            (
                upload.filename or "image.png",
                file_bytes,
                upload.content_type or "image/png",
            )
        )

    try:
        response = await openai_image_provider_service.edit(
            request=request,
            current_user=current_user,
            prompt=prompt,
            response_format=response_format,
            model=form.get("model"),
            images=images,
        )
    except ImageProviderError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return JSONResponse(response)
