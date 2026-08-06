from fastapi import APIRouter, HTTPException

from ..schemas.sheet import (
    CostEstimation,
    DesignBrief,
    DesignDescriptionRequest,
    Material,
    SketchData,
    TechPack,
    TechnicalSketches,
)
from ..services.sheet_ai_service import (
    GeminiServiceError,
    generate_cost_estimation,
    generate_design_description_from_images,
    generate_material_suggestions_from_images,
    generate_lining_sketch,
    generate_production_package,
    generate_technical_sketches,
    generate_visual_concepts,
    translate_annotations,
)

router = APIRouter()


@router.post("/visual-concepts")
async def create_visual_concepts(payload: dict):
    try:
        brief = DesignBrief.model_validate(payload.get("brief"))
        num_options = int(payload.get("numOptions") or 1)
        images = await generate_visual_concepts(brief, num_options)
        return {"images": images}
    except GeminiServiceError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid request payload") from exc


@router.post("/technical-sketches", response_model=TechnicalSketches)
async def create_technical_sketches(payload: dict):
    try:
        brief = DesignBrief.model_validate(payload.get("brief"))
        return await generate_technical_sketches(brief)
    except GeminiServiceError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except Exception as exc:
        import traceback, json
        print("Technical sketches payload error:", json.dumps(payload, ensure_ascii=False, default=str))
        traceback.print_exc()
        raise HTTPException(status_code=400, detail="Invalid request payload") from exc


@router.post("/lining-sketch")
async def create_lining_sketch(payload: dict):
    try:
        brief = DesignBrief.model_validate(payload.get("brief"))
        sketch = await generate_lining_sketch(brief)
        return {"sketch": sketch}
    except GeminiServiceError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid request payload") from exc


@router.post("/production-package", response_model=TechPack)
async def create_production_package(payload: dict):
    try:
        brief = DesignBrief.model_validate(payload.get("brief"))
        return await generate_production_package(brief)
    except GeminiServiceError as exc:
        print("Production package GeminiServiceError:", str(exc))
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except Exception as exc:
        import traceback, json
        print("Production package payload error:", json.dumps(payload, ensure_ascii=False, default=str))
        traceback.print_exc()
        raise HTTPException(status_code=400, detail="Invalid request payload") from exc


@router.post("/cost-estimation", response_model=CostEstimation)
async def create_cost_estimation(payload: dict):
    try:
        brief = DesignBrief.model_validate(payload.get("brief"))
        tech_pack = TechPack.model_validate(payload.get("techPack"))
        return await generate_cost_estimation(brief, tech_pack)
    except GeminiServiceError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except Exception as exc:
        import traceback, json
        print("Cost estimation payload error:", json.dumps(payload, ensure_ascii=False, default=str))
        traceback.print_exc()
        raise HTTPException(status_code=400, detail="Invalid request payload") from exc


@router.post("/translate-annotations")
async def translate_annotation_list(payload: dict):
    try:
        ann_list = payload.get("annotations") or []
        texts = [str(item.get("text") or "") for item in ann_list if isinstance(item, dict) and item.get("text")]
        target_language = str(payload.get("targetLanguage") or "Chinese")
        translations = await translate_annotations(texts, target_language)
        return {"translations": translations}
    except GeminiServiceError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except Exception as exc:
        import traceback, json
        print("Translate annotations payload error:", json.dumps(payload, ensure_ascii=False, default=str))
        traceback.print_exc()
        raise HTTPException(status_code=400, detail="Invalid request payload") from exc


@router.post("/design-description")
async def create_design_description(payload: dict):
    try:
        request = DesignDescriptionRequest.model_validate(payload)
        if not request.designImages:
            raise HTTPException(status_code=400, detail="designImages cannot be empty")
        description = await generate_design_description_from_images(
            [image.model_dump() for image in request.designImages],
            fallback_description=request.description or "",
        )
        return {"description": description}
    except GeminiServiceError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except HTTPException:
        raise
    except Exception as exc:
        import traceback, json
        print("Design description payload error:", json.dumps(payload, ensure_ascii=False, default=str))
        traceback.print_exc()
        raise HTTPException(status_code=400, detail="Invalid request payload") from exc


@router.post("/material-suggestions")
async def create_material_suggestions(payload: dict):
    try:
        images = payload.get("designImages") or []
        if not images:
            raise HTTPException(status_code=400, detail="designImages cannot be empty")
        suggestions = await generate_material_suggestions_from_images(images)
        materials: List[Material] = []
        for item in suggestions:
            materials.append(
                Material(
                    id=None,
                    name=item.get("name"),
                    specs=item.get("specs"),
                    image=None,
                )
            )
        return {"materials": [m.model_dump(exclude_none=True) for m in materials]}
    except GeminiServiceError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except HTTPException:
        raise
    except Exception as exc:
        import traceback, json
        print("Material suggestions payload error:", json.dumps(payload, ensure_ascii=False, default=str))
        traceback.print_exc()
        raise HTTPException(status_code=400, detail="Invalid request payload") from exc
