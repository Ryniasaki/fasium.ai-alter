import asyncio
import json
import re
from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple

import httpx

from ..schemas.sheet import (
    Annotation,
    CostEstimation,
    DesignBrief,
    SketchData,
    TechPack,
    TechnicalSketches,
)
from .config import get_settings
from .logger import get_proxy_logger

settings = get_settings()
logger = get_proxy_logger()

if not settings.gemini_api_key:
    raise ValueError("GEMINI_API_KEY is not configured in comfyui-tenant-service/.env")

# For legacy reasons we still read GEMINI_* env vars, but the traffic now goes to OpenRouter's
# OpenAI-compatible endpoints (we do not call the Gemini API directly anymore).
_OPENROUTER_API_KEY = settings.gemini_api_key
_BASE_URL = (settings.gemini_base_url or "https://openrouter.ai/api/v1").rstrip("/")
_DEFAULT_REFERER = "http://localhost"
_DEFAULT_TITLE = "ComfyUI Tenant Service"

# Model identifiers are OpenRouter model IDs (OpenAI-compatible interface).
_IMAGE_GENERATION_MODEL = "google/gemini-2.5-flash-image-preview"  # image-capable chat model
_MULTIMODAL_MODEL = "google/gemini-2.5-flash-image-preview"  # vision + text
_TEXT_MODEL = "google/gemini-2.5-flash"  # tech pack generation (text/JSON)
_ANALYSIS_MODEL = "google/gemini-2.5-flash-image-preview"  # vision-heavy tasks (annotations)
_COST_MODEL = "google/gemini-2.5-flash"  # cost estimation (text/JSON)
_TRANSLATION_MODEL = _TEXT_MODEL  # reuse text model for translations

_ANNOTATION_EXAMPLES = """
- NECKLINE AND CUFF BOTTOM DOUBLENEEDLE CHAIN STITCH
- THE BODY AND THE SLEEVES ARE MADE OF TWO LAYERS OF FABRIC
- STITCH 0.8CM FROM THE RAW EDGE OF THE NECKLINE
- HANGER LOOP AT LEFT SHOUDER, FOLDED LENGTH 6.5CM
- HEM&SLEEVE 2X2 RIB WITH GOOD RECOVRRY BY 4-THREAD OVERLOCKING
- 1CM WIDTH BUTTON HOLE FOR DRAWTIE
- WAIST TIE WITH 0.1CM EDGE STITCHES, DOUBLE FOLD.
- HEM WITH 2CMX 0.6CM DOUBLE NEEDLE CHAIN STITCH
- RIGHT SHOULDER LACE FABRIC GATHERING
- HEM BY 4-THREAD OVERLOCKING
- Place a hanging loop 2cm down from the armhole
- The outer layer and the lining are overlocked together
- BACK NECKLINE ATTACH 1CM ELASTIC WITH 4-THREAD O/L TURN AND TOPSTITCH 0.9CM
- HEM FINISH 0.3CM DENSE OVERLOCK
- NECKBAND WIDTH 1.8CM
- ARMHOLE, NECKLINE, SHOULDER STRAP WITH 1CM DOUBLE-FOLD, EDGE STITCHES
- BOTTOM OVERLOCKING STITCH 0.3CM WITH WAVE
- Neckline with 0.8cm single needle top stitch, self back neck bind
- Add internal jelly elastic band inside for fixation
- SIDE LENGTH 6CM SINGLE NEEDLE TOPSTITCH
- PRINCESS LINE
- SPLIT 9.5CM
- FABRIC COVERED BUTTON BUTTON LOOP
- O-RING THREADED WITH 0.8CM BIAS TAPE
- GATHERING IS APPLIED TO BOTH THE LINING AND THE OUTER SHELL
""".strip()

_ANNOTATION_CANVAS_MARGIN = 4.0  # keep annotation callouts away from the canvas edges

GARMENT_COST_REFERENCE = [
    {"label": "Menswear-Shirt", "labor": 100.0, "consumption": 2.0, "keywords": ["menswear-shirt", "men shirt", "mens shirt", "men's shirt", "shirt"]},
    {"label": "Menswear-Suit Jacket", "labor": 300.0, "consumption": 2.0, "keywords": ["suit jacket", "blazer", "menswear suit jacket"]},
    {"label": "Menswear-Suit Pants", "labor": 150.0, "consumption": 2.0, "keywords": ["suit pants", "menswear pants", "trousers"]},
    {"label": "Menswear-Suit Shorts", "labor": 100.0, "consumption": 1.5, "keywords": ["suit shorts", "tailored shorts"]},
    {"label": "Menswear-Waistcoat", "labor": 120.0, "consumption": 1.5, "keywords": ["waistcoat", "vest", "menswear vest"]},
    {"label": "Menswear-Short Sleeve Tee", "labor": 50.0, "consumption": 1.8, "keywords": ["short sleeve tee", "short sleeve t-shirt", "mens tee"]},
    {"label": "Menswear-Long Sleeve Tee", "labor": 50.0, "consumption": 2.0, "keywords": ["long sleeve tee", "long sleeve t-shirt"]},
    {"label": "Menswear-Down Jacket", "labor": 350.0, "consumption": 2.8, "keywords": ["down jacket", "puffer"]},
    {"label": "Menswear-Down Vest", "labor": 250.0, "consumption": 2.0, "keywords": ["down vest"]},
    {"label": "Menswear-Wool Coat", "labor": 300.0, "consumption": 2.5, "keywords": ["wool coat", "overcoat"]},
    {"label": "Menswear-Trench Coat", "labor": 240.0, "consumption": 2.5, "keywords": ["trench coat"]},
    {"label": "Menswear-Casual Jacket", "labor": 150.0, "consumption": 2.0, "keywords": ["casual jacket", "jacket"]},
    {"label": "Menswear-Shell Jacket", "labor": 200.0, "consumption": 2.0, "keywords": ["shell jacket", "outdoor jacket", "windbreaker"]},
    {"label": "Menswear-Hoodie", "labor": 70.0, "consumption": 2.0, "keywords": ["hoodie", "hooded sweatshirt"]},
    {"label": "Menswear-Sweatpants", "labor": 60.0, "consumption": 2.0, "keywords": ["sweatpants", "jogger"]},
    {"label": "Menswear-Shorts", "labor": 50.0, "consumption": 1.5, "keywords": ["shorts"]},
    {"label": "Womenswear-Shirt", "labor": 100.0, "consumption": 1.7, "keywords": ["womenswear shirt", "women shirt", "blouse"]},
    {"label": "Womenswear-Suit Jacket", "labor": 300.0, "consumption": 2.0, "keywords": ["womenswear suit jacket", "women blazer"]},
    {"label": "Womenswear-Suit Pants", "labor": 150.0, "consumption": 1.8, "keywords": ["womenswear suit pants", "women trousers"]},
    {"label": "Womenswear-Suit Shorts", "labor": 100.0, "consumption": 1.5, "keywords": ["womenswear suit shorts"]},
    {"label": "Womenswear-Waistcoat", "labor": 120.0, "consumption": 1.5, "keywords": ["women waistcoat", "women vest"]},
    {"label": "Womenswear-Short Sleeve Tee", "labor": 50.0, "consumption": 1.5, "keywords": ["womenswear short sleeve tee", "women short sleeve tee", "women t-shirt"]},
    {"label": "Womenswear-Long Sleeve Tee", "labor": 50.0, "consumption": 1.8, "keywords": ["womenswear long sleeve tee", "women long sleeve tee"]},
    {"label": "Womenswear-Down Jacket", "labor": 350.0, "consumption": 2.3, "keywords": ["womenswear down jacket"]},
    {"label": "Womenswear-Down Vest", "labor": 250.0, "consumption": 2.0, "keywords": ["womenswear down vest"]},
    {"label": "Womenswear-Wool Coat", "labor": 300.0, "consumption": 2.5, "keywords": ["women wool coat"]},
    {"label": "Womenswear-Trench Coat", "labor": 280.0, "consumption": 2.5, "keywords": ["women trench coat"]},
    {"label": "Womenswear-Casual Jacket", "labor": 150.0, "consumption": 2.0, "keywords": ["women casual jacket", "women jacket"]},
    {"label": "Womenswear-Outdoor Jacket", "labor": 200.0, "consumption": 2.0, "keywords": ["women outdoor jacket", "women shell jacket"]},
    {"label": "Womenswear-Sweatshirt", "labor": 70.0, "consumption": 2.0, "keywords": ["women sweatshirt"]},
    {"label": "Womenswear-Pullover Hoodie", "labor": 60.0, "consumption": 2.0, "keywords": ["women hoodie", "pullover hoodie"]},
    {"label": "Womenswear-Sweatpants", "labor": 60.0, "consumption": 2.0, "keywords": ["women sweatpants"]},
    {"label": "Womenswear-Sweat Shorts", "labor": 50.0, "consumption": 1.5, "keywords": ["women sweat shorts"]},
    {"label": "Womenswear-Dress", "labor": 100.0, "consumption": 2.0, "keywords": ["dress"]},
    {"label": "Womenswear-Skirt", "labor": 80.0, "consumption": 1.6, "keywords": ["skirt"]},
    {"label": "Womenswear-Bodysuit", "labor": 80.0, "consumption": 2.0, "keywords": ["bodysuit"]},
    {"label": "Womenswear-Jumpsuit", "labor": 100.0, "consumption": 2.0, "keywords": ["jumpsuit", "romper"]},
]

FABRIC_PRICE_REFERENCE = [
    {"label": "Ordinary woolen suiting", "price": 80.0, "keywords": ["ordinary woolen", "woolen fabric", "粗纺羊毛"]},
    {"label": "Worsted wool", "price": 200.0, "keywords": ["worsted", "精纺"]},
    {"label": "Poplin", "price": 25.0, "keywords": ["poplin", "府绸"]},
    {"label": "Mercerized liquid-ammonia cotton", "price": 65.0, "keywords": ["liquid ammonia", "mercerized", "高支高密全棉衬衫"]},
    {"label": "Woven nylon", "price": 30.0, "keywords": ["woven nylon", "尼龙"]},
    {"label": "Twill", "price": 30.0, "keywords": ["twill", "斜纹"]},
    {"label": "Woven polyester", "price": 20.0, "keywords": ["polyester", "聚酯纤维"]},
    {"label": "Polyester lining", "price": 18.0, "keywords": ["polyester lining", "里布"]},
    {"label": "Chiffon", "price": 18.0, "keywords": ["chiffon", "雪纺"]},
    {"label": "Synthetic suede", "price": 30.0, "keywords": ["synthetic suede", "仿麂皮"]},
    {"label": "Genuine suede", "price": 300.0, "keywords": ["genuine suede", "真皮绒"]},
    {"label": "Cow leather", "price": 300.0, "keywords": ["cow leather", "牛皮"]},
    {"label": "Lamb leather", "price": 350.0, "keywords": ["lamb leather", "小羊皮"]},
    {"label": "Sheepskin", "price": 300.0, "keywords": ["sheepskin", "羊皮"]},
    {"label": "Nappa leather", "price": 350.0, "keywords": ["nappa"]},
    {"label": "Imported leather", "price": 500.0, "keywords": ["imported leather", "进口皮料"]},
    {"label": "PU leather", "price": 30.0, "keywords": ["pu leather", "pu"]},
    {"label": "Silk", "price": 150.0, "keywords": ["silk", "真丝"]},
    {"label": "Cotton jersey", "price": 20.0, "keywords": ["cotton jersey", "汗布"]},
    {"label": "High-density cotton jersey", "price": 40.0, "keywords": ["high-density", "高密汗布", "interlock"]},
    {"label": "Polyester jersey", "price": 15.0, "keywords": ["polyester jersey"]},
    {"label": "Scuba / double knit", "price": 25.0, "keywords": ["scuba", "空气层"]},
    {"label": "Velour / velvet knit", "price": 20.0, "keywords": ["velour", "丝绒"]},
    {"label": "Sequined fabric", "price": 30.0, "keywords": ["sequined", "珠片"]},
    {"label": "Rib knit", "price": 20.0, "keywords": ["rib", "罗纹"]},
    {"label": "Jacquard knit", "price": 30.0, "keywords": ["jacquard"]},
]

DEFAULT_FABRIC_PRICE = 28.0
DEFAULT_LABOR_COST = 80.0
DEFAULT_CONSUMPTION = 1.8
_DEFAULT_MATERIAL_REFERENCE_LABEL = "Cotton jersey"


def _normalize_text(value: Optional[str]) -> str:
    return re.sub(r"\s+", " ", value.lower()).strip() if value else ""


def _match_garment_reference(*texts: Optional[str]) -> Optional[Dict[str, Any]]:
    haystack = _normalize_text(" ".join(filter(None, texts)))
    if not haystack:
        return None
    for ref in GARMENT_COST_REFERENCE:
        for keyword in ref["keywords"]:
            if keyword in haystack:
                return ref
    return None


def _match_fabric_reference(bom: Sequence[Any]) -> Tuple[float, str]:
    parts: List[str] = []
    for item in bom or []:
        if isinstance(item, dict):
            parts.append(str(item.get("item") or ""))
            parts.append(str(item.get("description") or ""))
        else:
            attr_item = getattr(item, "item", "")
            attr_desc = getattr(item, "description", "")
            parts.append(str(attr_item or ""))
            parts.append(str(attr_desc or ""))
    haystack = _normalize_text(" ".join(parts))
    for ref in FABRIC_PRICE_REFERENCE:
        for keyword in ref["keywords"]:
            if keyword in haystack:
                return ref["price"], ref["label"]
    return DEFAULT_FABRIC_PRICE, "Default fabric"


def _match_fabric_reference_from_texts(*texts: Optional[str]) -> Optional[Dict[str, Any]]:
    haystack = _normalize_text(" ".join(filter(None, texts)))
    if not haystack:
        return None
    for ref in FABRIC_PRICE_REFERENCE:
        candidates = list(ref.get("keywords") or [])
        candidates.append(ref["label"])
        for keyword in candidates:
            if _normalize_text(keyword) and _normalize_text(keyword) in haystack:
                return ref
    return None


def _default_material_reference() -> Dict[str, Any]:
    for ref in FABRIC_PRICE_REFERENCE:
        if ref["label"].lower() == _DEFAULT_MATERIAL_REFERENCE_LABEL.lower():
            return ref
    return {"label": _DEFAULT_MATERIAL_REFERENCE_LABEL, "price": DEFAULT_FABRIC_PRICE, "keywords": []}


def _format_currency(value: float) -> float:
    return round(float(value), 2)


def _format_price_label(value: float, suffix: str) -> str:
    return f"{value:.2f} {suffix}"


def _needs_price_override(value: Optional[Any]) -> bool:
    if value is None:
        return True
    if isinstance(value, (int, float)):
        return value <= 0
    text_value = str(value).strip().lower()
    if not text_value:
        return True
    stripped = text_value.replace("rmb", "").replace("¥", "").replace("/", "").strip()
    try:
        numeric = float(stripped.split()[0])
        return numeric <= 0
    except ValueError:
        return False

class GeminiServiceError(RuntimeError):
    """Raised when OpenRouter calls fail or return malformed payloads."""


def _openrouter_headers(extra: Optional[Dict[str, str]] = None) -> Dict[str, str]:
    headers = {
        "Authorization": f"Bearer {_OPENROUTER_API_KEY}",
        "Content-Type": "application/json",
        "HTTP-Referer": getattr(settings, "openrouter_referer", None) or _DEFAULT_REFERER,
        "X-Title": getattr(settings, "openrouter_title", None) or _DEFAULT_TITLE,
    }
    if extra:
        headers.update(extra)
    return headers


async def _post_openrouter(path: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    url = f"{_BASE_URL}/{path.lstrip('/')}"
    async with httpx.AsyncClient(timeout=httpx.Timeout(120.0, connect=10.0)) as client:
        response = await client.post(url, json=payload, headers=_openrouter_headers())
        try:
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            detail = await exc.response.aread()
            detail_text = detail.decode("utf-8", errors="replace") if isinstance(detail, (bytes, bytearray)) else str(detail)
            logger.error("OpenRouter request failed [%s]: %s", exc.response.status_code, detail_text)
            raise GeminiServiceError(f"OpenRouter request failed with status {exc.response.status_code}: {detail_text}") from exc
        return response.json()


def _build_detailed_prompt(brief: DesignBrief, purpose: str) -> str:
    prompt = f"{purpose}\n\n**Design Description:**\n{brief.description}\n\n"
    if brief.materials and any(m.name or m.specs for m in brief.materials):
        prompt += "**Specified Materials:**\n"
        for material in brief.materials:
            if material.name or material.specs:
                prompt += f"- {material.name or 'Material'}: {material.specs or ''}\n"
    return prompt


def _build_vision_messages(brief: DesignBrief, text_prompt: str) -> List[Dict[str, Any]]:
    """Build OpenAI-compatible multimodal message array."""
    content: List[Dict[str, Any]] = [{"type": "text", "text": text_prompt}]
    if brief.designImages:
        for image in brief.designImages:
            data_uri = f"data:{image.mimeType};base64,{image.data}"
            content.insert(
                0,
                {
                    "type": "image_url",
                    "image_url": {"url": data_uri},
                },
            )
    return [{"role": "user", "content": content}]


def _extract_chat_text(response: Dict[str, Any]) -> str:
    choices = response.get("choices", [])
    for choice in choices:
        message = choice.get("message") or {}
        content = message.get("content")
        if isinstance(content, list):
            texts = [part.get("text") for part in content if isinstance(part, dict) and part.get("type") == "text"]
            if texts:
                return "\n".join(t for t in texts if t).strip()
        if isinstance(content, str):
            return content.strip()
    return ""


def _extract_json(response: Dict[str, Any]) -> Any:
    text = _extract_chat_text(response)
    if not text:
        raise GeminiServiceError("OpenRouter response did not include any text output.")
    match = re.search(r"```(?:json)?\s*([\s\S]+?)\s*```", text)
    if match:
        text = match.group(1).strip()
    return json.loads(text)


def _normalize_tech_pack_payload(raw: Any, brief: DesignBrief) -> Dict[str, Any]:
    """
    Coerce the model output into the TechPack shape; fill fallbacks so validation won't fail
    on missing keys. This mirrors the Fasium-bandan expectation but is resilient to
    partial model outputs from OpenRouter.
    """
    if not isinstance(raw, dict):
        raise GeminiServiceError("Tech pack payload is not a JSON object.")

    payload: Dict[str, Any] = dict(raw)
    payload.setdefault("description", brief.description)

    bom = payload.get("billOfMaterials")
    if not isinstance(bom, list):
        # fallback: derive from materials in brief
        bom = []
        for mat in brief.materials or []:
            name = mat.name or "Material"
            desc = mat.specs or ""
            bom.append({"item": name, "description": desc})
        payload["billOfMaterials"] = bom

    spec = payload.get("specSheet")
    if not isinstance(spec, list):
        payload["specSheet"] = []

    construction = payload.get("constructionDetails")
    if not isinstance(construction, list):
        payload["constructionDetails"] = []

    return payload


def _ensure_breakdown_item(payload: Dict[str, Any], matcher: Callable[[str], bool], *, default_name: str) -> Dict[str, Any]:
    breakdown = payload.setdefault("costBreakdown", [])
    for item in breakdown:
        name = str(item.get("item") or "")
        if matcher(name.lower()):
            return item
    new_item = {"item": default_name, "consumption": "", "unitPrice": "", "cost": 0.0}
    breakdown.append(new_item)
    return new_item


def _apply_cost_reference(
    payload: Dict[str, Any],
    brief: DesignBrief,
    tech_pack: TechPack,
) -> None:
    breakdown = payload.setdefault("costBreakdown", [])
    rule = _match_garment_reference(payload.get("garmentType"), brief.description)
    if not rule:
        rule = _match_garment_reference(brief.description)
    labor_cost = rule["labor"] if rule else DEFAULT_LABOR_COST
    consumption = rule["consumption"] if rule else DEFAULT_CONSUMPTION

    fabric_price, fabric_label = _match_fabric_reference(tech_pack.billOfMaterials or [])
    fabric_cost = fabric_price * consumption

    labor_item = _ensure_breakdown_item(payload, lambda name: "labor" in name, default_name="Labor")
    if not labor_item.get("consumption"):
        labor_item["consumption"] = "1 unit"
    labor_item["unitPrice"] = labor_item.get("unitPrice") or _format_price_label(labor_cost, "RMB")
    if not labor_item.get("cost") or labor_item["cost"] <= 0:
        labor_item["cost"] = _format_currency(labor_cost)

    fabric_item = _ensure_breakdown_item(
        payload,
        lambda name: "fabric" in name or "shell" in name,
        default_name=fabric_label if fabric_label != "Default fabric" else "Main Fabric",
    )
    if not fabric_item.get("consumption"):
        fabric_item["consumption"] = f"{consumption:.2f} m"
    if _needs_price_override(fabric_item.get("unitPrice")):
        fabric_item["unitPrice"] = _format_price_label(fabric_price, "RMB/m")
    if not fabric_item.get("cost") or fabric_item["cost"] <= 0:
        fabric_item["cost"] = _format_currency(fabric_cost)

    trims_item = _ensure_breakdown_item(payload, lambda name: "trim" in name or "accessor" in name, default_name="Trims & Accessories")
    trims_item.setdefault("consumption", "1 set")
    trims_item.setdefault("unitPrice", "calculated")
    trims_cost = max(fabric_item.get("cost", 0.0) * 0.15, 10.0)
    if not trims_item.get("cost") or trims_item["cost"] <= 0:
        trims_item["cost"] = _format_currency(trims_cost)

    payload["totalEstimatedCost"] = _format_currency(sum(float(item.get("cost") or 0) for item in breakdown))
    notes = payload.setdefault("notes", [])
    if rule and all("labor reference" not in note.lower() for note in notes if isinstance(note, str)):
        notes.append(
            f"Labor cost derived from reference '{rule['label']}' ({labor_cost:.0f} RMB, {consumption:.2f} m consumption)."
        )
    if fabric_label and all("fabric price reference" not in note.lower() for note in notes if isinstance(note, str)):
        notes.append(f"Fabric price reference: {fabric_label} at {fabric_price:.0f} RMB/m.")


def _normalize_cost_payload(raw: Any, brief: DesignBrief, tech_pack: TechPack) -> Dict[str, Any]:
    """Coerce model output into CostEstimation shape with required fields."""
    if not isinstance(raw, dict):
        raise GeminiServiceError("Cost estimation payload is not a JSON object.")

    payload: Dict[str, Any] = dict(raw)
    breakdown = payload.get("costBreakdown")
    if not isinstance(breakdown, list):
        payload["costBreakdown"] = []
        breakdown = payload["costBreakdown"]

    normalized_items = []
    for item in breakdown:
        if not isinstance(item, dict):
            continue
        normalized_items.append(
            {
                "item": item.get("item") or "Item",
                "consumption": item.get("consumption") or "1 unit",
                "unitPrice": item.get("unitPrice") or "0",
                "cost": float(item.get("cost") or 0),
            }
        )
    payload["costBreakdown"] = normalized_items
    payload.setdefault("garmentType", "Unknown")
    payload.setdefault("totalEstimatedCost", sum(i["cost"] for i in normalized_items))
    payload.setdefault("notes", [])
    try:
        _apply_cost_reference(payload, brief, tech_pack)
    except Exception as exc:
        logger.warning("Failed to apply cost reference fallback: %s", exc)
    return payload


async def _chat_completion(
    model: str,
    messages: List[Dict[str, Any]],
    *,
    response_format: Optional[Dict[str, Any]] = None,
    max_tokens: Optional[int] = None,
    modalities: Optional[List[str]] = None,
) -> Dict[str, Any]:
    body: Dict[str, Any] = {"model": model, "messages": messages}
    if response_format:
        body["response_format"] = response_format
    if max_tokens:
        body["max_tokens"] = max_tokens
    if modalities:
        body["modalities"] = modalities
    return await _post_openrouter("chat/completions", body)


async def _generate_images(prompt: str, num_options: int, *, aspect_ratio: str = "3:4") -> List[str]:
    """Use OpenRouter chat/completions with image modality; returns base64 (data URL stripped)."""
    messages = [
        {
            "role": "user",
            "content": prompt,
        }
    ]
    body: Dict[str, Any] = {
        "model": _IMAGE_GENERATION_MODEL,
        "messages": messages,
        "modalities": ["image", "text"],
        "n": num_options,
        "image_config": {"aspect_ratio": aspect_ratio},
    }
    response = await _post_openrouter("chat/completions", body)
    images: List[str] = []
    for choice in response.get("choices", []):
        message = choice.get("message") or {}
        for img in message.get("images", []) or []:
            data_url = (
                img.get("image_url", {}).get("url")
                or img.get("imageUrl", {}).get("url")
            )
            if data_url and data_url.startswith("data:"):
                # strip data URL header
                b64 = data_url.split(",", 1)[-1]
                images.append(b64)
    return images


async def _generate_images_with_references(brief: DesignBrief, prompt: str, num_options: int) -> List[str]:
    """Generate images using both reference photos and text prompt."""
    messages: List[Dict[str, Any]] = [
        {
          "role": "system",
          "content": [{"type": "text", "text": "Generate photorealistic fashion photos faithful to the provided reference images. Maintain silhouette, colors, trims, and key details."}],
        }
    ]
    messages.extend(_build_vision_messages(brief, prompt))
    body: Dict[str, Any] = {
        "model": _IMAGE_GENERATION_MODEL,
        "messages": messages,
        "modalities": ["image", "text"],
        "n": num_options,
        "image_config": {"aspect_ratio": "3:4"},
    }
    response = await _post_openrouter("chat/completions", body)
    images: List[str] = []
    for choice in response.get("choices", []):
        message = choice.get("message") or {}
        for img in message.get("images", []) or []:
            data_url = (
                img.get("image_url", {}).get("url")
                or img.get("imageUrl", {}).get("url")
            )
            if data_url and data_url.startswith("data:"):
                b64 = data_url.split(",", 1)[-1]
                images.append(b64)
    return images


async def _vision_prompt_from_images(brief: DesignBrief, *, base_instruction: str) -> str:
    """Derive a concise image-generation prompt from reference images."""
    messages = [
        {
            "role": "system",
            "content": [
                {"type": "text", "text": f"{base_instruction} Return only the improved prompt text."},
            ],
        }
    ]
    messages.extend(_build_vision_messages(brief, brief.description))
    response = await _chat_completion(
        _MULTIMODAL_MODEL,
        messages,
        max_tokens=256,
        modalities=["text", "image"],
    )
    prompt = _extract_chat_text(response).strip()
    return prompt or brief.description


async def generate_design_description_from_images(
    design_images: List[Dict[str, Any]],
    fallback_description: str = "",
) -> str:
    if not design_images:
        raise GeminiServiceError("At least one reference image is required to describe the design.")
    brief = DesignBrief(
        description=fallback_description or "Reference garment provided by the designer.",
        designImages=design_images,
        materials=[],
    )
    messages = [
        {
            "role": "system",
            "content": [
                {
                    "type": "text",
                    "text": (
                        "You are a senior fashion designer writing production briefs. "
                        "Describe garments with precise language covering silhouette, fit, key materials, "
                        "color palette, and notable trims. Keep the tone professional and avoid mentioning images or photos."
                    ),
                }
            ],
        }
    ]
    messages.extend(
        _build_vision_messages(
            brief,
            (
                "Analyze the reference garment(s) and write a concise design description of 3-4 sentences (80-120 words). "
                "Mention silhouette, proportions, fabrication, surface details, and signature trims so that a production team "
                "immediately understands the intent."
            ),
        )
    )
    response = await _chat_completion(
        _MULTIMODAL_MODEL,
        messages,
        max_tokens=320,
        modalities=["text", "image"],
    )
    description = _extract_chat_text(response).strip()
    if not description:
        raise GeminiServiceError("Design description generation returned empty output.")
    return description


async def generate_material_suggestions_from_images(
    design_images: List[Dict[str, Any]],
) -> List[Dict[str, str]]:
    if not design_images:
        raise GeminiServiceError("At least one reference image is required to suggest materials.")
    brief = DesignBrief(
        description="Reference garment provided by the designer.",
        designImages=design_images,
        materials=[],
    )
    messages = [
        {
            "role": "system",
            "content": [
                {
                    "type": "text",
                    "text": (
                        "You are a senior materials developer. Analyze garments and describe their fabrics, linings, "
                        "and trims using specific fiber content, weight, weave/knit structure, finishes, and colors."
                        "Respond with JSON only."
                    ),
                }
            ],
        }
    ]
    messages.extend(
        _build_vision_messages(
            brief,
            (
                "List up to four materials or trims used in this garment. For each entry, provide:"
                ' {"name": "short material or trim name", "specs": "detailed specs (fiber %, weight, finish, color, notable trims)"}'
                "Include key trims like buttons, zippers, or decorative elements if visible."
                "If uncertain, make the most reasonable assumption but clearly describe observable characteristics."
                "Return ONLY a JSON array."
            ),
        )
    )
    response = await _chat_completion(
        _MULTIMODAL_MODEL,
        messages,
        max_tokens=512,
        modalities=["text", "image"],
    )
    try:
        parsed = _extract_json(response)
    except (json.JSONDecodeError, GeminiServiceError) as exc:
        raise GeminiServiceError("Material suggestion output was not valid JSON.") from exc
    if isinstance(parsed, dict):
        parsed = parsed.get("materials") or parsed.get("items") or parsed.get("data") or parsed
    if not isinstance(parsed, list):
        raise GeminiServiceError("Material suggestion output must be a JSON array.")
    normalized: List[Dict[str, str]] = []
    for item in parsed:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "").strip()
        specs = str(item.get("specs") or item.get("description") or "").strip()
        if not name and not specs:
            continue
        normalized.append({"name": name, "specs": specs})
    if not normalized:
        raise GeminiServiceError("Material suggestions were empty after parsing.")
    mapped: List[Dict[str, str]] = []
    default_ref = _default_material_reference()
    for material in normalized:
        ref = _match_fabric_reference_from_texts(material.get("name"), material.get("specs")) or default_ref
        specs = material.get("specs") or f"Reference fabric: {ref['label']} ({ref['price']:.0f} RMB/m)."
        mapped.append({"name": ref["label"], "specs": specs})
    return mapped


async def generate_visual_concepts_from_text_only(description: str, num_options: int) -> List[str]:
    prompt = (
        f'Generate {num_options} distinct design concepts for: "{description}". '
        "For each concept, create a photorealistic fashion photograph of a model wearing the garment. "
        "Use a clean, neutral studio background and a full-body shot. Ensure the designs look unique yet faithful to the description."
    )
    images = await _generate_images(prompt, num_options, aspect_ratio="3:4")
    if not images:
        raise GeminiServiceError("OpenRouter did not return any visual concepts.")
    return images


async def generate_visual_concepts(brief: DesignBrief, num_options: int = 1) -> List[str]:
    if brief.designImages:
        prompt = (
            "Create a single photorealistic fashion photograph of a model wearing the garment from the reference images. "
            "Keep silhouette, colors, trims, fabric feel, and signature details identical to the references; avoid style drift. "
            f"Neutral studio background, full-body shot. Description: {brief.description}"
        )
        images = await _generate_images_with_references(brief, prompt, 1)
        if images:
            return images
        logger.warning("OpenRouter image generation with references failed. Falling back to text-only generation.")
        return await generate_visual_concepts_from_text_only(brief.description, 1)
    return await generate_visual_concepts_from_text_only(brief.description, num_options)


async def generate_sketch_image(brief: DesignBrief, sketch_prompt: str) -> str:
    prompt_to_use = sketch_prompt
    if brief.designImages:
        enriched = await _vision_prompt_from_images(
            brief,
            base_instruction="Summarize the garment visuals into a concise prompt for a vector-style technical flat sketch.",
        )
        prompt_to_use = f"{sketch_prompt}\nReference-based prompt: {enriched}"
    images = await _generate_images(prompt_to_use, 1, aspect_ratio="1:1")
    if images:
        return images[0]
    raise GeminiServiceError("Sketch generation failed to return an image.")


def _clamp_annotation_coordinates(annotations: List[Annotation]) -> List[Annotation]:
    min_coord = _ANNOTATION_CANVAS_MARGIN
    max_coord = 100.0 - _ANNOTATION_CANVAS_MARGIN
    for annotation in annotations:
        annotation.x = max(min_coord, min(max_coord, float(annotation.x)))
        annotation.y = max(min_coord, min(max_coord, float(annotation.y)))
    return annotations


async def generate_annotations_for_sketch(brief: DesignBrief, sketch_image: str, view: str) -> List[Annotation]:
    prompt = f"""
You are an expert senior technical designer. Analyze the provided technical sketch for the {view} view and produce 7-10 factory-ready construction callouts.
Every coordinate must sit inside the garment body—never outside the edges or blank canvas.

**Style Guide**
{_ANNOTATION_EXAMPLES}

Return ONLY JSON with objects containing:
- "text": construction instruction.
- "x": horizontal coordinate ({_ANNOTATION_CANVAS_MARGIN}-{100 - _ANNOTATION_CANVAS_MARGIN}).
- "y": vertical coordinate ({_ANNOTATION_CANVAS_MARGIN}-{100 - _ANNOTATION_CANVAS_MARGIN}).
Coordinates MUST stay within this safe range so callouts remain on top of the garment silhouette—never floating on the background.
"""
    messages = [
        {
            "role": "system",
            "content": [{"type": "text", "text": "Return only JSON. Follow the style guide strictly."}],
        },
        {
            "role": "user",
            "content": [
                {
                    "type": "image_url",
                    "image_url": {"url": f"data:image/png;base64,{sketch_image}"},
                },
                {"type": "text", "text": prompt},
            ],
        },
    ]
    response = await _chat_completion(
        _ANALYSIS_MODEL,
        messages,
        max_tokens=800,
        modalities=["text", "image"],
    )
    try:
        payload = _extract_json(response)
    except (json.JSONDecodeError, GeminiServiceError):
        logger.warning("Failed to parse annotation JSON from OpenRouter response")
        return []
    annotations: List[Annotation] = []
    items = payload.get("annotations") if isinstance(payload, dict) else payload
    if isinstance(items, list):
        for item in items:
            try:
                annotations.append(Annotation(text=item["text"], x=float(item["x"]), y=float(item["y"])))
            except (KeyError, TypeError, ValueError):
                continue
    return _clamp_annotation_coordinates(annotations)


async def generate_technical_sketches(brief: DesignBrief) -> TechnicalSketches:
    async def build_sketch(view: str) -> SketchData:
        sketch_prompt = f"""
**TASK: GENERATE A TECHNICAL FLAT SKETCH OF THE {view.upper()} VIEW ONLY.**
Maintain identical scale across views. Create a professional colored vector-style flat sketch with black outlines, dashed seam lines, and a pure white background.
Focus solely on the garment torso (no head, hands, or legs). Base the sketch strictly on the provided references and description: "{brief.description}".
"""
        image = await generate_sketch_image(brief, sketch_prompt.strip())
        annotations = await generate_annotations_for_sketch(brief, image, view)
        return SketchData(image=image, annotations=annotations)

    front, back = await asyncio.gather(build_sketch("front"), build_sketch("back"))
    return TechnicalSketches(front=front, back=back)


async def generate_lining_sketch(brief: DesignBrief) -> Optional[SketchData]:
    needs_lining = bool(
        brief.designImages
        and re.search(r"(lining|lined|jacket|blazer|coat|inner layer)", brief.description, flags=re.IGNORECASE)
    )
    if not needs_lining:
        return None
    prompt = f"""
Create a colored vector-style technical flat sketch of ONLY THE INNER LINING of the garment described as "{brief.description}".
Use flat colors, clean outlines, dashed stitching, and a white background. Focus on the lining construction only.
"""
    image = await generate_sketch_image(brief, prompt.strip())
    annotations = await generate_annotations_for_sketch(brief, image, "lining")
    return SketchData(image=image, annotations=annotations)


async def generate_production_package(brief: DesignBrief) -> TechPack:
    purpose = (
        "Based on the provided fashion design reference images and description, create a complete production tech pack in JSON format. "
        "Use the specified materials as the primary source for the bill of materials."
    )
    prompt = _build_detailed_prompt(brief, purpose)
    # OpenRouter's gemini-2.5-flash is text-only; feed text prompt without images to avoid INVALID_ARGUMENT.
    messages = [
        {
            "role": "system",
            "content": [{"type": "text", "text": "Return only valid JSON for the tech pack."}],
        },
        {"role": "user", "content": prompt},
    ]
    response = await _chat_completion(
        _TEXT_MODEL,
        messages,
        response_format={"type": "json_object"},
        max_tokens=2048,
    )
    raw_text = _extract_chat_text(response)
    try:
        raw_payload = _extract_json(response)
        normalized = _normalize_tech_pack_payload(raw_payload, brief)
        return TechPack.model_validate(normalized)
    except (json.JSONDecodeError, GeminiServiceError) as exc:
        logger.error("Tech pack raw response text: %s", raw_text)
        logger.error("Tech pack full response: %s", json.dumps(response, ensure_ascii=False, default=str))
        raise GeminiServiceError("OpenRouter returned invalid tech pack JSON.") from exc
    except Exception as exc:
        logger.error(
            "Tech pack validation failed: %s | raw_text=%s | response=%s",
            exc,
            raw_text,
            json.dumps(response, ensure_ascii=False, default=str),
        )
        raise GeminiServiceError("Failed to validate tech pack response.") from exc


async def generate_cost_estimation(brief: DesignBrief, tech_pack: TechPack) -> CostEstimation:
    bom_lines = "\n".join(f"- {item.item}: {item.description}" for item in tech_pack.billOfMaterials)
    construction = "\n".join(tech_pack.constructionDetails)
    prompt = f"""
You are a professional garment production cost accountant. Create a detailed cost estimation in JSON format strictly following the rules below.

**FIXED COSTING RULES (RMB):**
- Labor per piece: T-shirt 20, Shirt 35, Pants 35, Dress 45, Jacket/Coat/Blazer 100.
- Fabric prices per meter: Chiffon 20, Cotton Poplin 25, Faux Suede 30. Use 28 if unspecified.
- Fabric consumption per piece: Tops 1.8m, Pants 1.8m, Dress 2.0m.
- Trims & Accessories: 15% of fabric cost (or 10 RMB if fabric unknown).

**DETAILED LABOR & CONSUMPTION REFERENCE**
| Category | Garment | Labor (RMB) | Consumption (m) |
| Menswear | Shirt | 100 | 2.0 |
| Menswear | Suit Jacket | 300 | 2.0 |
| Menswear | Suit Pants | 150 | 2.0 |
| Menswear | Suit Shorts | 100 | 1.5 |
| Menswear | Waistcoat | 120 | 1.5 |
| Menswear | Short Sleeve Tee | 50 | 1.8 |
| Menswear | Long Sleeve Tee | 50 | 2.0 |
| Menswear | Down Jacket | 350 | 2.8 |
| Menswear | Down Vest | 250 | 2.0 |
| Menswear | Wool Coat | 300 | 2.5 |
| Menswear | Trench Coat | 240 | 2.5 |
| Menswear | Casual Jacket | 150 | 2.0 |
| Menswear | Shell Jacket | 200 | 2.0 |
| Menswear | Hoodie | 70 | 2.0 |
| Menswear | Sweatpants | 60 | 2.0 |
| Menswear | Shorts | 50 | 1.5 |
| Womenswear | Shirt | 100 | 1.7 |
| Womenswear | Suit Jacket | 300 | 2.0 |
| Womenswear | Suit Pants | 150 | 1.8 |
| Womenswear | Suit Shorts | 100 | 1.5 |
| Womenswear | Waistcoat | 120 | 1.5 |
| Womenswear | Short Sleeve Tee | 50 | 1.5 |
| Womenswear | Long Sleeve Tee | 50 | 1.8 |
| Womenswear | Down Jacket | 350 | 2.3 |
| Womenswear | Down Vest | 250 | 2.0 |
| Womenswear | Wool Coat | 300 | 2.5 |
| Womenswear | Trench Coat | 280 | 2.5 |
| Womenswear | Casual Jacket | 150 | 2.0 |
| Womenswear | Outdoor Jacket | 200 | 2.0 |
| Womenswear | Sweatshirt | 70 | 2.0 |
| Womenswear | Pullover Hoodie | 60 | 2.0 |
| Womenswear | Sweatpants | 60 | 2.0 |
| Womenswear | Sweat Shorts | 50 | 1.5 |
| Womenswear | Dress | 100 | 2.0 |
| Womenswear | Skirt | 80 | 1.6 |
| Womenswear | Bodysuit | 80 | 2.0 |
| Womenswear | Jumpsuit | 100 | 2.0 |

Always match the closest garment type from this table and use its labor & consumption unless the BOM clearly specifies otherwise.

**FABRIC PRICE LOOKUP (RMB / meter)**
- Ordinary woolen suiting: 80
- Worsted wool: 200
- Poplin: 25
- Mercerized liquid-ammonia cotton shirting: 65
- Woven nylon: 30
- Twill: 30
- Woven polyester: 20
- Polyester lining: 18
- Chiffon: 18
- Synthetic suede: 30
- Genuine suede: 300
- Cow leather: 300
- Lamb leather: 350
- Sheepskin: 300
- Nappa leather: 350
- Imported leather: 500
- PU leather: 30
- Silk: 150
- Cotton jersey (180-240gsm): 20
- High-density cotton jersey: 40
- Polyester jersey: 15
- Scuba / double-knit air layer: 25
- Velour / velvet knit: 20
- Sequined fabric: 30
- Rib knit: 20
- Jacquard knit: 30

Prefer these fabric prices when BOM materials match; otherwise make the closest reasonable assumption and document it.

**INPUT**
Description: {brief.description}
Bill of Materials:
{bom_lines}
Construction Details:
{construction}

Return JSON with garmentType, costBreakdown[], totalEstimatedCost, and notes[].
"""
    messages = [
        {"role": "system", "content": [{"type": "text", "text": "Return only valid JSON."}]},
        {"role": "user", "content": [{"type": "text", "text": prompt}]},
    ]
    response = await _chat_completion(
        _COST_MODEL,
        messages,
        response_format={"type": "json_object"},
        max_tokens=1200,
    )
    try:
        raw_payload = _extract_json(response)
        normalized = _normalize_cost_payload(raw_payload, brief, tech_pack)
        payload = normalized
    except (json.JSONDecodeError, GeminiServiceError) as exc:
        raise GeminiServiceError("OpenRouter returned invalid cost estimation JSON.") from exc
    except Exception as exc:
        logger.error("Cost estimation normalization failed: %s", exc)
        raise GeminiServiceError("Failed to validate cost estimation response.") from exc
    return CostEstimation.model_validate(payload)


async def translate_annotations(texts: List[str], target_language: str) -> List[str]:
    if not texts:
        return []
    language = target_language.strip() or "Chinese"
    prompt = (
        f"Translate the following garment construction annotations into {language}. "
        "Preserve the order and return only JSON with a 'translations' array of strings, same length as input."
    )
    numbered = "\n".join(f"{idx+1}. {text}" for idx, text in enumerate(texts))
    messages = [
        {"role": "system", "content": [{"type": "text", "text": "You are a concise translation assistant. Return only JSON."}]},
        {"role": "user", "content": [{"type": "text", "text": f"{prompt}\n\nAnnotations:\n{numbered}"}]},
    ]
    response = await _chat_completion(
        _TRANSLATION_MODEL,
        messages,
        response_format={"type": "json_object"},
        max_tokens=600,
    )
    payload = _extract_json(response)
    if isinstance(payload, dict):
        translations = payload.get("translations")
    else:
        translations = payload
    if not isinstance(translations, list):
        raise GeminiServiceError("Translation payload missing translations array.")
    normalized: List[str] = []
    for item in translations:
        try:
            normalized.append(str(item))
        except Exception:
            normalized.append("")
    # ensure length alignment
    while len(normalized) < len(texts):
        normalized.append("")
    return normalized[: len(texts)]
