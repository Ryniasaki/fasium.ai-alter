
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { SparklesIcon, UploadIcon, TrashIcon } from './IconComponents';
import type { DesignBrief, Material } from '../types';
import { autoDescribeDesignImages, autoSuggestMaterials } from '../services/geminiService';

interface DesignInputFormProps {
    onGenerate: (brief: DesignBrief) => void;
    disabled: boolean;
    initialBrief?: DesignBrief | null;
}

// Helper function to handle file reading
const fileToBase64 = (file: File): Promise<{ mimeType: string; data: string }> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => {
            const result = reader.result as string;
            const mimeType = result.split(',')[0].split(':')[1].split(';')[0];
            const data = result.split(',')[1];
            resolve({ mimeType, data });
        };
        reader.onerror = error => reject(error);
    });
};

export const DesignInputForm: React.FC<DesignInputFormProps> = ({ onGenerate, disabled, initialBrief }) => {
    const [description, setDescription] = useState<string>('');
    const [designImages, setDesignImages] = useState<({ id: string; mimeType: string; data: string; })[]>([]);
    const [materials, setMaterials] = useState<Material[]>([
        { id: crypto.randomUUID(), name: 'Main Fabric', specs: '' }
    ]);
    const [descriptionVisible, setDescriptionVisible] = useState(false);
    const [isGeneratingDescription, setIsGeneratingDescription] = useState(false);
    const [autoDescriptionError, setAutoDescriptionError] = useState<string | null>(null);
    const autoDescriptionRequestRef = useRef(0);
    const hasManualEditRef = useRef(false);
    const [isGeneratingMaterials, setIsGeneratingMaterials] = useState(false);
    const [autoMaterialsError, setAutoMaterialsError] = useState<string | null>(null);
    const autoMaterialsRequestRef = useRef(0);
    const materialsEditedRef = useRef(false);

    const handleGenerateDetails = useCallback(async () => {
        if (!designImages.length) {
            setDescriptionVisible(true);
            const message = 'Upload at least one reference image before generating details.';
            setAutoDescriptionError(message);
            setAutoMaterialsError(message);
            return;
        }
        setDescriptionVisible(true);
        const descriptionRequestId = autoDescriptionRequestRef.current + 1;
        autoDescriptionRequestRef.current = descriptionRequestId;
        setIsGeneratingDescription(true);
        setAutoDescriptionError(null);

        const materialsRequestId = autoMaterialsRequestRef.current + 1;
        autoMaterialsRequestRef.current = materialsRequestId;
        setIsGeneratingMaterials(true);
        setAutoMaterialsError(null);

        const payload = designImages.map(({ mimeType, data }) => ({ mimeType, data }));

        try {
            const [generatedDescription, suggestedMaterials] = await Promise.all([
                autoDescribeDesignImages(payload, description),
                autoSuggestMaterials(payload),
            ]);

            if (autoDescriptionRequestRef.current === descriptionRequestId && !hasManualEditRef.current) {
                setDescription(generatedDescription);
                setDescriptionVisible(true);
                hasManualEditRef.current = false;
            }

            if (autoMaterialsRequestRef.current === materialsRequestId) {
                const normalized = suggestedMaterials
                    .filter(mat => (mat.name && mat.name.trim()) || (mat.specs && mat.specs.trim()))
                    .map(mat => ({
                        id: crypto.randomUUID(),
                        name: mat.name?.trim() || 'Material',
                        specs: mat.specs?.trim() || '',
                    }));
                if (normalized.length) {
                    setMaterials(normalized);
                    materialsEditedRef.current = false;
                }
            }
        } catch (error) {
            if (autoDescriptionRequestRef.current === descriptionRequestId) {
                setAutoDescriptionError(
                    error instanceof Error ? error.message : 'Failed to auto-generate description. Please fill it manually.',
                );
            }
            if (autoMaterialsRequestRef.current === materialsRequestId) {
                setAutoMaterialsError(
                    error instanceof Error ? error.message : 'Failed to auto-suggest materials. Please add them manually.',
                );
            }
        } finally {
            if (autoDescriptionRequestRef.current === descriptionRequestId) {
                setIsGeneratingDescription(false);
            }
            if (autoMaterialsRequestRef.current === materialsRequestId) {
                setIsGeneratingMaterials(false);
            }
        }
    }, [designImages, description]);

    const isGeneratingDesignDetails = isGeneratingDescription || isGeneratingMaterials;
    const showMaterialsSection = descriptionVisible && Boolean(description.trim());

    useEffect(() => {
        if (initialBrief) {
            setDescription(initialBrief.description || '');
            const mappedImages = (initialBrief.designImages || []).map(img => ({...img, id: crypto.randomUUID()}));
            setDesignImages(mappedImages);
            const materialSeed =
                initialBrief.materials.length > 0
                    ? initialBrief.materials.map(mat => ({
                        id: mat.id || crypto.randomUUID(),
                        name: mat.name || '',
                        specs: mat.specs || '',
                    }))
                    : [{ id: crypto.randomUUID(), name: 'Main Fabric', specs: '' }];
            setMaterials(materialSeed);
            setDescriptionVisible(Boolean(initialBrief.description));
            hasManualEditRef.current = Boolean(initialBrief.description);
            materialsEditedRef.current = materialSeed.some(mat => (mat.name && mat.name.trim()) || (mat.specs && mat.specs.trim()));
            setAutoDescriptionError(null);
            setAutoMaterialsError(null);
            setIsGeneratingDescription(false);
            setIsGeneratingMaterials(false);
            autoDescriptionRequestRef.current = 0;
            autoMaterialsRequestRef.current = 0;
        }
    }, [initialBrief]);

    const handleDesignImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0] && designImages.length < 4) {
            const file = e.target.files[0];
            try {
                const base64Image = await fileToBase64(file);
                setDesignImages(prev => [...prev, { ...base64Image, id: crypto.randomUUID() }]);
            } catch(error) {
                console.error("Error converting file to base64", error);
            } finally {
                e.target.value = ''; // Reset file input
            }
        }
    };

    const removeDesignImage = (id: string) => {
        setDesignImages(prev => prev.filter(img => img.id !== id));
    };

    const handleMaterialChange = (id: string, field: keyof Omit<Material, 'id'>, value: any) => {
        materialsEditedRef.current = true;
        setMaterials(materials.map(m => m.id === id ? { ...m, [field]: value } : m));
    };
    
    const addMaterial = () => {
        materialsEditedRef.current = true;
        setMaterials([...materials, { id: crypto.randomUUID(), name: '', specs: '' }]);
    };

    const removeMaterial = (id: string) => {
        materialsEditedRef.current = true;
        setMaterials(materials.filter(m => m.id !== id));
    };

    const handleDescriptionChange = (value: string) => {
        hasManualEditRef.current = value.trim().length > 0;
        setDescription(value);
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onGenerate({
            description,
            designImages: designImages.map(({ id, ...rest }) => rest),
            materials
        });
    };

    return (
        <div className="max-w-4xl mx-auto">
             <div className="text-center max-w-3xl mx-auto mb-8">
                <h2 className="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">From Idea to Tech Pack in Seconds</h2>
                <p className="mt-4 text-lg text-gray-600">
                    Describe your clothing design, upload references, and specify materials. Our AI will generate photorealistic models, technical sketches, and a complete production-ready package.
                </p>
            </div>
            <form onSubmit={handleSubmit} className="space-y-8">
                <div className="bg-white p-6 md:p-8 rounded-lg shadow-md border border-gray-200">
                    <h3 className="text-xl font-semibold text-gray-800 mb-4">1. Your Design</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                            <label className="block text-sm font-medium text-gray-700">Reference Images (Optional, up to 4)</label>
                            <p className="text-sm text-gray-500 mb-2">Provide multiple images to show different angles or details of the same item.</p>
                            <div className="grid grid-cols-2 gap-4">
                                {designImages.map((image) => (
                                    <div key={image.id} className="relative">
                                        <img src={`data:${image.mimeType};base64,${image.data}`} alt="preview" className="w-full h-32 object-cover rounded-md border" />
                                        <button
                                            type="button"
                                            onClick={() => removeDesignImage(image.id)}
                                            aria-label="Remove image"
                                            className="absolute top-1 right-1 bg-white bg-opacity-75 rounded-full p-1 text-gray-600 hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                        >
                                            <TrashIcon className="w-5 h-5" />
                                        </button>
                                    </div>
                                ))}
                                {designImages.length < 4 && (
                                    <div className="flex justify-center items-center px-6 pt-5 pb-6 border-2 border-gray-300 border-dashed rounded-md h-32">
                                        <div className="space-y-1 text-center">
                                            <UploadIcon className="mx-auto h-12 w-12 text-gray-400" />
                                            <div className="flex text-sm text-gray-600">
                                                <label htmlFor="design-image-upload" className="relative cursor-pointer bg-white rounded-md font-medium text-indigo-600 hover:text-indigo-500 focus-within:outline-none focus-within:ring-2 focus-within:ring-offset-2 focus-within:ring-indigo-500">
                                                    <span>Upload image</span>
                                                    <input id="design-image-upload" name="design-image-upload" type="file" className="sr-only" onChange={handleDesignImageChange} accept="image/*" disabled={disabled} />
                                                </label>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                            <div className="mt-4 space-y-2">
                                <button
                                    type="button"
                                    onClick={handleGenerateDetails}
                                    className="inline-flex items-center gap-2 rounded-md border border-indigo-500 px-4 py-2 text-sm font-medium text-indigo-600 hover:bg-indigo-50 disabled:opacity-50 disabled:cursor-not-allowed"
                                    disabled={!designImages.length || disabled || isGeneratingDesignDetails}
                                >
                                    <SparklesIcon className="w-4 h-4" />
                                    {isGeneratingDesignDetails ? 'Generating design description & materials…' : 'Generate design description'}
                                </button>
                                {(autoDescriptionError || autoMaterialsError) && (
                                    <div className="space-y-1">
                                        {autoDescriptionError && (
                                            <p className="text-sm text-red-600">{autoDescriptionError}</p>
                                        )}
                                        {autoMaterialsError && (
                                            <p className="text-sm text-red-600">{autoMaterialsError}</p>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                        <div className="space-y-3">
                            {(descriptionVisible || description) && (
                                <>
                                    <label htmlFor="design-prompt" className="block text-sm font-medium text-gray-700">
                                        Design Description
                                    </label>
                                    {isGeneratingDescription && !hasManualEditRef.current && (
                                        <p className="text-sm text-indigo-600 flex items-center gap-2">
                                            <SparklesIcon className="w-4 h-4" />
                                            Generating a description from your reference image...
                                        </p>
                                    )}
                                    <textarea
                                        id="design-prompt"
                                        rows={8}
                                        className="w-full p-3 border border-gray-300 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition duration-150 ease-in-out text-base"
                                        placeholder="e.g., A men's relaxed fit camp collar shirt in off-white linen with coconut shell buttons..."
                                        value={description}
                                        onChange={(e) => handleDescriptionChange(e.target.value)}
                                        disabled={disabled}
                                    />
                                </>
                            )}
                        </div>
                    </div>
                </div>

                {showMaterialsSection && (
                    <div className="bg-white p-6 md:p-8 rounded-lg shadow-md border border-gray-200">
                        <h3 className="text-xl font-semibold text-gray-800 mb-4">2. Materials & Trims</h3>
                        <div className="space-y-6">
                            {materials.map((material, index) => (
                                <div key={material.id} className="grid grid-cols-1 gap-4 p-4 border rounded-md relative bg-gray-50/50">
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                        <div>
                                            <label htmlFor={`material-name-${index}`} className="block text-sm font-medium text-gray-700">Name</label>
                                            <input type="text" id={`material-name-${index}`} value={material.name} onChange={e => handleMaterialChange(material.id, 'name', e.target.value)} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2 focus:ring-indigo-500 focus:border-indigo-500" />
                                        </div>
                                        <div>
                                            <label htmlFor={`material-specs-${index}`} className="block text-sm font-medium text-gray-700">Specifications</label>
                                            <input type="text" id={`material-specs-${index}`} value={material.specs} onChange={e => handleMaterialChange(material.id, 'specs', e.target.value)} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2 focus:ring-indigo-500 focus:border-indigo-500" />
                                        </div>
                                    </div>
                                    {materials.length > 1 && (
                                        <button type="button" onClick={() => removeMaterial(material.id)} aria-label="Remove material" className="absolute -top-3 -right-3 bg-red-100 text-red-600 rounded-full p-1 hover:bg-red-200 focus:outline-none focus:ring-2 focus:ring-red-500">
                                            <TrashIcon className="w-4 h-4" />
                                        </button>
                                    )}
                                </div>
                            ))}
                        </div>
                        <button type="button" onClick={addMaterial} className="mt-4 text-indigo-600 font-semibold hover:text-indigo-800 transition-colors">+ Add another material/trim</button>
                    </div>
                )}
                
                <button
                    type="submit"
                    className="w-full flex items-center justify-center bg-indigo-600 text-white font-semibold py-3 px-4 rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:bg-indigo-300 disabled:cursor-not-allowed transition duration-150 ease-in-out"
                    disabled={disabled || !description.trim()}
                >
                    <SparklesIcon className="w-5 h-5 mr-2" />
                    Generate Production Package
                </button>
            </form>
        </div>
    );
};
