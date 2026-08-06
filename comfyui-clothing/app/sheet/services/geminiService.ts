import type { CostEstimation, DesignBrief, Material, SketchData, TechnicalSketches, TechPack } from '../types';

const getSheetApiBase = () => '/api/proxy/sheet';

const getAuthHeader = () => {
  if (typeof window === 'undefined') throw new Error('Authorization header required');
  const token = localStorage.getItem('auth_token');
  if (!token) throw new Error('Authorization header required');
  return `Bearer ${token}`;
};

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${getSheetApiBase()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: getAuthHeader() },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(detail || `Request to ${path} failed with status ${response.status}`);
  }
  return response.json() as Promise<T>;
}

type VisualConceptResponse = { images: string[] };
type LiningSketchResponse = { sketch?: SketchData | null };

export async function generateVisualConcepts(brief: DesignBrief, numOptions: number = 1): Promise<string[]> {
  const data = await postJson<VisualConceptResponse>('/visual-concepts', { brief, numOptions });
  return data.images;
}

export async function generateTechnicalSketches(brief: DesignBrief): Promise<Omit<TechnicalSketches, 'lining'>> {
  const data = await postJson<TechnicalSketches>('/technical-sketches', { brief });
  return { front: data.front, back: data.back };
}

export async function generateLiningSketch(brief: DesignBrief): Promise<SketchData | undefined> {
  const data = await postJson<LiningSketchResponse>('/lining-sketch', { brief });
  return data.sketch ?? undefined;
}

export async function generateProductionPackageData(brief: DesignBrief): Promise<TechPack> {
  return postJson<TechPack>('/production-package', { brief });
}

export async function generateCostEstimation(brief: DesignBrief, techPack: TechPack): Promise<CostEstimation> {
  return postJson<CostEstimation>('/cost-estimation', { brief, techPack });
}

export async function translateAnnotations(
  annotations: Array<{ id: string; text: string }>,
  targetLanguage: string,
): Promise<Record<string, string>> {
  const data = await postJson<{ translations: string[] }>('/translate-annotations', {
    annotations: annotations.map(({ id, text }) => ({ id, text })),
    targetLanguage,
  });
  const map: Record<string, string> = {};
  data.translations?.forEach((translated, idx) => {
    const id = annotations[idx]?.id;
    if (id) map[id] = translated;
  });
  return map;
}

type DesignDescriptionResponse = { description: string };

export async function autoDescribeDesignImages(
  designImages: { mimeType: string; data: string }[],
  existingDescription: string = '',
): Promise<string> {
  if (!designImages.length) {
    throw new Error('At least one design image is required to describe the design.');
  }
  const data = await postJson<DesignDescriptionResponse>('/design-description', {
    designImages,
    description: existingDescription,
  });
  if (!data.description) {
    throw new Error('Design description generation returned no text.');
  }
  return data.description;
}

type MaterialSuggestionResponse = {
  materials: Array<{ name?: string; specs?: string }>;
};

export async function autoSuggestMaterials(
  designImages: { mimeType: string; data: string }[],
): Promise<Pick<Material, 'name' | 'specs'>[]> {
  if (!designImages.length) {
    throw new Error('At least one design image is required to suggest materials.');
  }
  const data = await postJson<MaterialSuggestionResponse>('/material-suggestions', {
    designImages,
  });
  return (data.materials || []).map((item) => ({
    name: item.name || '',
    specs: item.specs || '',
  }));
}
