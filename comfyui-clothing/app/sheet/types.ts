
export interface Material {
    id: string;
    name: string;
    specs: string;
}

export interface DesignBrief {
    description: string;
    designImages: { mimeType: string; data: string }[];
    materials: Material[];
}


export interface BillOfMaterialsItem {
    item: string;
    description: string;
}

export interface SpecSheetItem {
    pointOfMeasure: string;
    measurement: string;
}

export interface TechPack {
    description: string;
    billOfMaterials: BillOfMaterialsItem[];
    specSheet: SpecSheetItem[];
    constructionDetails: string[];
}

export interface Annotation {
    id: string;
    text: string;
    x: number; // percentage from left
    y: number; // percentage from top
    textX: number; // text box x, percentage
    textY: number; // text box y, percentage
}

export interface SketchData {
    image: string; // base64 string
    annotations: Omit<Annotation, 'id' | 'textX' | 'textY'>[]; 
}


export interface TechnicalSketches {
    front: SketchData;
    back: SketchData;
    lining?: SketchData;
}

export interface CostBreakdownItem {
    item: string;
    consumption: string;
    unitPrice: string;
    cost: number;
}

export interface CostEstimation {
    garmentType: string;
    costBreakdown: CostBreakdownItem[];
    totalEstimatedCost: number;
    notes: string[];
}

export interface ProjectData {
    prompt: string;
    visualConcepts: string[];
    technicalSketches: TechnicalSketches;
    techPack: TechPack;
    costEstimation: CostEstimation;
}
