from typing import List, Optional

from pydantic import BaseModel, Field


class ImagePayload(BaseModel):
    mimeType: str
    data: str


class Material(BaseModel):
    id: Optional[str] = None
    name: Optional[str] = None
    specs: Optional[str] = None
    image: Optional[ImagePayload] = None


class DesignBrief(BaseModel):
    description: str
    designImages: List[ImagePayload] = Field(default_factory=list)
    materials: List[Material] = Field(default_factory=list)


class Annotation(BaseModel):
    text: str
    x: float
    y: float


class SketchData(BaseModel):
    image: str
    annotations: List[Annotation] = Field(default_factory=list)


class TechnicalSketches(BaseModel):
    front: SketchData
    back: SketchData


class BillOfMaterialsItem(BaseModel):
    item: str
    description: str


class SpecSheetItem(BaseModel):
    pointOfMeasure: str
    measurement: str


class TechPack(BaseModel):
    description: str
    billOfMaterials: List[BillOfMaterialsItem]
    specSheet: List[SpecSheetItem]
    constructionDetails: List[str]


class CostBreakdownItem(BaseModel):
    item: str
    consumption: str
    unitPrice: str
    cost: float


class CostEstimation(BaseModel):
    garmentType: str
    costBreakdown: List[CostBreakdownItem]
    totalEstimatedCost: float
    notes: List[str]


class DesignDescriptionRequest(BaseModel):
    description: Optional[str] = None
    designImages: List[ImagePayload] = Field(default_factory=list)
