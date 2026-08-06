import React, { useState, useEffect, useRef, useCallback, useImperativeHandle, forwardRef } from 'react';
import type { ProjectData, TechPack, CostEstimation, CostBreakdownItem, SketchData, Annotation } from '../types';
import { DownloadIcon, RedoIcon, InfoIcon, TrashIcon, PlusCircleIcon, ChevronDownIcon, CalculatorIcon, RefreshIcon, SaveIcon, GripVerticalIcon, PencilIcon } from './IconComponents';
import { EditableField } from './EditableField';
import { translateAnnotations } from '../services/geminiService';

interface ResultsDisplayProps {
    projectData: ProjectData;
    onReset: () => void;
    onSaveProject: (techPack: TechPack, costEstimation: CostEstimation) => void;
}

type Tab = 'bom' | 'specs' | 'construction';

// =================================================================
// START: AnnotatedSketch Component (and its children)
// =================================================================

// Helper function to trigger file downloads
const downloadFile = (href: string, filename: string) => {
    const link = document.createElement('a');
    link.href = href;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
};


interface AnnotationItemProps {
    annotation: Annotation & { order?: number };
    onAnchorPositionChange: (id: string, newPosition: { x: number; y: number }) => void;
    containerRef: React.RefObject<HTMLDivElement>;
}

const AnnotationItem: React.FC<AnnotationItemProps> = ({ annotation, onAnchorPositionChange, containerRef }) => {

    const handleAnchorMouseDown = (e: React.MouseEvent) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();

        if (!containerRef.current) return;
        const rect = containerRef.current.getBoundingClientRect();

        const handleMouseMove = (moveEvent: MouseEvent) => {
            const newX = Math.max(0, Math.min(100, ((moveEvent.clientX - rect.left) / rect.width) * 100));
            const newY = Math.max(0, Math.min(100, ((moveEvent.clientY - rect.top) / rect.height) * 100));
            onAnchorPositionChange(annotation.id, { x: newX, y: newY });
        };

        const handleMouseUp = () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
    };


    return (
        <>
            {/* Draggable numbered pin on image */}
            <div
                onMouseDown={handleAnchorMouseDown}
                className="absolute w-8 h-8 bg-indigo-600 text-white font-semibold text-sm rounded-full border-2 border-white shadow-md -translate-x-1/2 -translate-y-1/2 cursor-move z-10 flex items-center justify-center"
                style={{ left: `${annotation.x}%`, top: `${annotation.y}%` }}
                aria-label="Drag anchor point"
            >
                {(annotation as any).order ?? ''}
            </div>
        </>
    );
};


interface AnnotatedSketchProps {
    sketchData: SketchData;
    title: string;
    filename: string;
}

type DownloadStyle = 'screen' | 'pdf';
interface DownloadOptions {
    outputType?: 'download' | 'dataUrl';
    style?: DownloadStyle;
}

interface AnnotatedSketchHandles {
    downloadSketchOnly: () => void;
    downloadAnnotated: () => Promise<void>;
    getAnnotatedDataUrl: (style: DownloadStyle) => Promise<string>;
    translateAll: (language: string) => Promise<void>;
}


const AnnotatedSketch = forwardRef<AnnotatedSketchHandles, AnnotatedSketchProps>(({ sketchData, title, filename }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const imageRef = useRef<HTMLImageElement>(null);
    const relativeContainerRef = useRef<HTMLDivElement>(null);
    const [annotations, setAnnotations] = useState<Array<Annotation & { id: string; order?: number }>>([]);
    const [isTranslating, setIsTranslating] = useState(false);

    const renumber = useCallback((list: Array<Annotation & { id: string; order?: number }>) => {
        return list.map((a, idx) => ({ ...a, order: idx + 1 }));
    }, []);
    const [isDownloadMenuOpen, setDownloadMenuOpen] = useState(false);

    useEffect(() => {
            const numbered = sketchData.annotations
                .map((a, idx) => ({ ...a, id: crypto.randomUUID(), order: idx + 1 }));
            setAnnotations(numbered);
            setIsTranslating(false);
        }, [renumber, sketchData]);

    const handleSaveText = (id: string, text: string) => {
        setAnnotations(prev => renumber(prev.map(a => a.id === id ? { ...a, text } : a)));
    };

    const handleDelete = (id: string) => {
        setAnnotations(prev => renumber(prev.filter(a => a.id !== id)));
    };

    const handleAnchorPositionChange = (id: string, newPosition: { x: number, y: number }) => {
        setAnnotations(prev => renumber(prev.map(a => a.id === id ? { ...a, x: newPosition.x, y: newPosition.y } : a)));
    };

    const translateAll = useCallback(async (language: string) => {
        if (!annotations.length) return;
        setIsTranslating(true);
        try {
            const map = await translateAnnotations(
                annotations.map(({ id, text }) => ({ id, text })),
                language || 'English',
            );
            setAnnotations(prev => renumber(prev.map(a => map[a.id] ? { ...a, text: map[a.id] } : a)));
        } finally {
            setIsTranslating(false);
        }
    }, [annotations, renumber]);

    const doDownloadSketchOnly = useCallback(() => {
        downloadFile(`data:image/png;base64,${sketchData.image}`, filename);
    }, [sketchData.image, filename]);

    const doDownloadAnnotated = useCallback(async (options: DownloadOptions = {}): Promise<string | void> => {
        const { outputType = 'download', style = 'screen' } = options;
        if (!imageRef.current || !imageRef.current.complete || imageRef.current.naturalHeight === 0) {
            await new Promise((resolve, reject) => {
                if(!imageRef.current) return reject(new Error("Image ref not available."));
                imageRef.current.onload = resolve;
                imageRef.current.onerror = reject;
            });
        }
        
        const image = imageRef.current;
        if (!image) throw new Error("Image ref not available for download.");
        
        const { naturalWidth, naturalHeight } = image;
        
        const TEXT_BOX_WIDTH = 220;
        const TEXT_PADDING = 10;
        const PADDING = 20;
        const V_PADDING = 50;
        const FONT_SIZE = 15;
        
        const canvas = document.createElement('canvas');
        canvas.width = naturalWidth + TEXT_BOX_WIDTH + (PADDING * 3);
        canvas.height = naturalHeight + (V_PADDING * 2);
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error("Could not get canvas context.");

        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const imageXOffset = PADDING;
        const imageYOffset = V_PADDING;
        ctx.drawImage(image, imageXOffset, imageYOffset, naturalWidth, naturalHeight);

        ctx.lineWidth = 1.5;
        
        if (style === 'pdf') {
            ctx.strokeStyle = '#000000';
            ctx.font = '12pt Calibri, sans-serif';
        } else { // screen style
            ctx.strokeStyle = '#EF4444'; // Red lines
            ctx.font = `${FONT_SIZE}px Inter, sans-serif`;
        }


        const drawWrappedText = (text: string, x: number, y: number, maxWidth: number, lineHeight: number) => {
            const words = text.split(' ');
            let line = '';
            let lineCount = 0;
            for (const word of words) {
                const testLine = line + word + ' ';
                if (ctx.measureText(testLine).width > maxWidth && line.length > 0) {
                    ctx.fillText(line, x, y + (lineCount * lineHeight));
                    line = word + ' ';
                    lineCount++;
                } else {
                    line = testLine;
                }
            }
            ctx.fillText(line, x, y + (lineCount * lineHeight));
            return (lineCount + 1);
        };
        
        const listX = imageXOffset + naturalWidth + (PADDING * 2);
        let currentY = imageYOffset;

        annotations.forEach((ann, idx) => {
            const anchorAbsX = imageXOffset + (ann.x / 100) * naturalWidth;
            const anchorAbsY = imageYOffset + (ann.y / 100) * naturalHeight;

            // badge on image
            ctx.fillStyle = '#4F46E5';
            ctx.beginPath();
            ctx.arc(anchorAbsX, anchorAbsY, 10, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#FFFFFF';
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.fillStyle = '#FFFFFF';
            ctx.font = 'bold 12px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(String(idx + 1), anchorAbsX, anchorAbsY);

            // list entry on the right
            ctx.textAlign = 'left';
            ctx.textBaseline = 'top';
            ctx.fillStyle = '#111827';
            ctx.font = `${FONT_SIZE}px Inter, sans-serif`;
            const lineHeight = 18;
            const lines = drawWrappedText(ann.text, listX + 26, currentY, TEXT_BOX_WIDTH - 30, lineHeight);

            // badge beside text
            ctx.fillStyle = '#E0E7FF';
            ctx.beginPath();
            ctx.arc(listX + 10, currentY + (lineHeight * lines) / 2 - 4, 10, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#4F46E5';
            ctx.font = 'bold 12px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(String(idx + 1), listX + 10, currentY + (lineHeight * lines) / 2 - 4);

            currentY += Math.max(lineHeight * lines + 12, 30);
        });

        const dataUrl = canvas.toDataURL('image/jpeg', 0.9);

        if (outputType === 'download') {
            downloadFile(dataUrl, filename.replace('.png', '-annotated.jpg'));
            return;
        }
        return dataUrl;
    }, [annotations, filename, sketchData.image]);
    
    // FIX: Corrected typo in useImperativeHandle.
    useImperativeHandle(ref, () => ({
        downloadSketchOnly: doDownloadSketchOnly,
        downloadAnnotated: () => doDownloadAnnotated({ outputType: 'download', style: 'screen' }) as Promise<void>,
        getAnnotatedDataUrl: (style: DownloadStyle) => doDownloadAnnotated({ outputType: 'dataUrl', style }) as Promise<string>,
        translateAll,
    }), [doDownloadSketchOnly, doDownloadAnnotated, translateAll]);
    
    const handleDownloadSketchOnlyClick = useCallback(() => {
        doDownloadSketchOnly();
        setDownloadMenuOpen(false);
    }, [doDownloadSketchOnly]);

    const handleDownloadAnnotatedClick = useCallback(async () => {
        setDownloadMenuOpen(false);
        await doDownloadAnnotated({ outputType: 'download', style: 'screen' });
    }, [doDownloadAnnotated]);


    return (
        <div>
            <div className="relative group bg-gray-100 p-3 border rounded-lg">
                <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
                    <div className="lg:col-span-3">
                        <div ref={containerRef} className="w-full">
                            <div ref={relativeContainerRef} className="relative">
                                <img ref={imageRef} src={`data:image/png;base64,${sketchData.image}`} alt={`${title} sketch`} className="rounded-md object-contain w-full h-auto" crossOrigin="anonymous"/>
                                {annotations.map(ann => (
                                    <AnnotationItem
                                        key={ann.id}
                                        annotation={ann as any}
                                        onAnchorPositionChange={handleAnchorPositionChange}
                                        containerRef={relativeContainerRef}
                                    />
                                ))}
                            </div>
                        </div>
                    </div>
                    <div className="lg:col-span-2 bg-white border border-gray-200 rounded-md p-3 max-h-[520px] overflow-auto">
                        <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center space-x-2 text-sm text-gray-600">
                                <PencilIcon className="w-4 h-4" />
                                <span>Annotation List</span>
                            </div>
                            <div className="flex items-center space-x-2">
                                <div className="relative">
                                    <button
                                        onClick={() => setDownloadMenuOpen(prev => !prev)}
                                        className="p-1.5 bg-gray-100 hover:bg-gray-200 rounded-full shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 flex items-center"
                                        aria-label="Download options"
                                    >
                                        <DownloadIcon className="w-4 h-4 text-gray-700" />
                                        <ChevronDownIcon className="w-3 h-3 text-gray-700 ml-1" />
                                    </button>
                                    {isDownloadMenuOpen && (
                                        <div className="absolute right-0 mt-2 w-48 bg-white rounded-md shadow-lg z-10 border border-gray-200">
                                            <ul className="py-1 text-sm text-gray-700">
                                                <li>
                                                    <button onClick={handleDownloadSketchOnlyClick} className="block w-full text-left px-4 py-2 hover:bg-gray-100">Sketch Only (.png)</button>
                                                </li>
                                                <li>
                                                    <button onClick={handleDownloadAnnotatedClick} className="block w-full text-left px-4 py-2 hover:bg-gray-100">With Annotations (.jpg)</button>
                                                </li>
                                            </ul>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                        <div className="space-y-2">
                            {annotations.map((ann, idx) => (
                                <div key={ann.id} className="flex items-start space-x-2 bg-gray-50 border border-gray-200 rounded-md p-2">
                                    <div className="flex-shrink-0 w-7 h-7 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-xs font-semibold">{idx + 1}</div>
                                    <EditableField
                                        initialValue={ann.text}
                                        onSave={(newText) => handleSaveText(ann.id, newText)}
                                        as="textarea"
                                        className="text-gray-800 text-sm leading-snug w-full"
                                        style={{ minHeight: '2.5rem' }}
                                    />
                                    <button onClick={() => handleDelete(ann.id)} className="text-gray-400 hover:text-red-600 mt-0.5">
                                        <TrashIcon className="w-4 h-4" />
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
            <p className="text-center font-medium text-sm mt-2 text-gray-600">{title}</p>
        </div>
    );
});


// =================================================================
// END: AnnotatedSketch Component
// =================================================================

const SectionCard: React.FC<{ title: string; children: React.ReactNode; className?: string; icon?: React.ReactNode; actions?: React.ReactNode }> = ({ title, children, className = '', icon, actions }) => (
    <div className={`bg-white rounded-lg shadow-md border border-gray-200 overflow-hidden ${className}`}>
        <div className="p-4 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
            <h3 className="text-lg font-semibold text-gray-800 flex items-center">
                {icon && <span className="mr-3">{icon}</span>}
                {title}
            </h3>
            {actions && <div className="flex items-center space-x-2">{actions}</div>}
        </div>
        <div className="p-4 md:p-6">
            {children}
        </div>
    </div>
);


const createPdfHtml = async (
    projectData: ProjectData,
    techPack: TechPack,
    costEstimation: CostEstimation,
    orderedSketches: Array<{
        id: string;
        sketchData: SketchData;
        title: string;
        filename: string;
        ref: React.RefObject<AnnotatedSketchHandles>;
    } | undefined>
) => {
    
    const loadImageMeta = (url: string) =>
        new Promise<{ url: string; width: number; height: number }>((resolve) => {
            const img = new Image();
            img.onload = () => resolve({ url, width: img.naturalWidth, height: img.naturalHeight });
            img.onerror = () => resolve({ url, width: 0, height: 0 });
            img.src = url;
        });

    const sketchImagePromises = orderedSketches.map(async (sketch) => {
        if (!sketch) return undefined;
        const dataUrl = await sketch.ref.current?.getAnnotatedDataUrl('screen');
        if (!dataUrl) return undefined;
        return loadImageMeta(dataUrl);
    });

    const sketchImageMetas = await Promise.all(sketchImagePromises);

    const sketchPagesHtml = orderedSketches.map((sketch, index) => {
        const meta = sketchImageMetas[index];
        if (!sketch || !meta) return '';
        return `
        <div class="page landscape-page">
            <h2 class="text-2xl font-bold mb-6 text-center">${sketch.title} - Annotated</h2>
            <div class="flex-grow flex items-center justify-center">
                 <img src="${meta.url}" width="${meta.width}" height="${meta.height}" class="max-w-full" style="max-height: 75vh; max-width: 90%; height: auto; width: auto; object-fit: contain;"/>
            </div>
        </div>`;
        }).join('');
    
    const bomRows = techPack.billOfMaterials.map(row => `
        <tr class="border-b">
            <td class="px-4 py-2">${row.item}</td>
            <td class="px-4 py-2">${row.description}</td>
        </tr>
    `).join('');

    const specRows = techPack.specSheet.map(row => `
        <tr class="border-b">
            <td class="px-4 py-2">${row.pointOfMeasure}</td>
            <td class="px-4 py-2">${row.measurement}</td>
        </tr>
    `).join('');

    const constructionItems = techPack.constructionDetails.map(detail => `
        <li class="flex items-start"><span class="mr-2">&bull;</span><span>${detail}</span></li>
    `).join('');
    
    const costRows = costEstimation.costBreakdown.map(row => `
         <tr class="border-b">
            <td class="px-4 py-2">${row.item}</td>
            <td class="px-4 py-2">${row.consumption}</td>
            <td class="px-4 py-2">${row.unitPrice}</td>
            <td class="px-4 py-2 text-right">${row.cost.toFixed(2)}</td>
        </tr>
    `).join('');

    const costNotes = costEstimation.notes.map(note => `
        <li class="flex items-start"><span class="mr-2">&bull;</span><span>${note}</span></li>
    `).join('');
    

    return `
    <html>
        <head>
            <title>Design Package: ${projectData.prompt}</title>
            <script src="https://cdn.tailwindcss.com"></script>
            <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
            <style>
                body { font-family: 'Calibri', 'Inter', sans-serif; font-size: 12pt; margin: 0; }
                img { max-width: 100%; height: auto; }
                @media print {
                    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                    
                    @page {
                        size: A4 portrait;
                        margin: 1.5cm;
                         @bottom-center {
                            content: "Page " counter(page) " of " counter(pages);
                            font-size: 10pt;
                            color: #666;
                        }
                    }

                    @page landscape {
                        size: A4 landscape;
                    }
                    
                    .page {
                        page-break-after: always;
                        width: 100%;
                        min-height: 100vh;
                    }
                    .landscape-page {
                        page: landscape;
                    }
                }
                .page {
                    width: 100%;
                    min-height: 95vh;
                    display: flex;
                    flex-direction: column;
                    position: relative;
                }
                
            </style>
        </head>
        <body class="bg-white text-gray-800">
            <!-- Title Page -->
            <div class="page items-center justify-center text-center">
                <h1 class="text-4xl font-bold mb-4">Design Package</h1>
                <p class="text-lg text-gray-600 max-w-2xl italic">"${projectData.prompt}"</p>
            </div>

            <!-- Visual Concepts -->
            <div class="page">
                <h2 class="text-2xl font-bold mb-6">Visual Concept</h2>
                <div class="flex-grow flex items-center justify-center">
                     <img src="data:image/jpeg;base64,${projectData.visualConcepts[0]}" class="rounded-lg shadow-md max-w-full" style="max-height: 80vh;" />
                </div>
            </div>
            
            <!-- Annotated Sketches -->
            ${sketchPagesHtml}
            
            <!-- Tech Pack -->
            <div class="page">
                <h2 class="text-2xl font-bold mb-6">Production Tech Pack</h2>
                <div class="space-y-6">
                    <div>
                        <h3 class="text-xl font-semibold mb-2">Description</h3>
                        <p class="text-gray-700 whitespace-pre-wrap">${techPack.description}</p>
                    </div>
                    <div>
                        <h3 class="text-xl font-semibold mb-2">Bill of Materials</h3>
                        <table class="w-full text-sm text-left text-gray-600">
                            <thead class="text-xs text-gray-700 uppercase bg-gray-100"><tr><th class="px-4 py-2">Item</th><th class="px-4 py-2">Description</th></tr></thead>
                            <tbody>${bomRows}</tbody>
                        </table>
                    </div>
                     <div>
                        <h3 class="text-xl font-semibold mb-2">Measurement Specs (Size M)</h3>
                        <table class="w-full text-sm text-left text-gray-600">
                            <thead class="text-xs text-gray-700 uppercase bg-gray-100"><tr><th class="px-4 py-2">Point of Measure</th><th class="px-4 py-2">Measurement</th></tr></thead>
                            <tbody>${specRows}</tbody>
                        </table>
                    </div>
                    <div>
                        <h3 class="text-xl font-semibold mb-2">Construction Details</h3>
                        <ul class="space-y-1 text-gray-700 list-inside">${constructionItems}</ul>
                    </div>
                </div>
            </div>

            <!-- Cost Estimation (Last Page) -->
            <div class="page" style="page-break-after: auto;">
                 <h2 class="text-2xl font-bold mb-6">Cost Estimation</h2>
                 <div class="space-y-6">
                    <div>
                         <h3 class="text-xl font-semibold mb-2">Cost Breakdown (per unit)</h3>
                         <table class="w-full text-sm text-left text-gray-600">
                            <thead class="text-xs text-gray-700 uppercase bg-gray-100">
                                <tr>
                                    <th class="px-4 py-2">Item</th>
                                    <th class="px-4 py-2">Consumption (面料单耗)</th>
                                    <th class="px-4 py-2">Unit Price (面料单价)</th>
                                    <th class="px-4 py-2 text-right">Cost (RMB)</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${costRows}
                                 <tr class="font-bold bg-gray-50">
                                    <td class="px-4 py-2" colspan="3">Total Estimated Cost</td>
                                    <td class="px-4 py-2 text-right">${costEstimation.totalEstimatedCost.toFixed(2)}</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                    <div>
                        <h3 class="text-xl font-semibold mb-2">Notes & Assumptions</h3>
                        <ul class="space-y-1 text-gray-700 list-inside">${costNotes}</ul>
                     </div>
                 </div>
            </div>
            <script>
                (async () => {
                    const waitForImages = async () => {
                        const imgs = Array.from(document.images);
                        await Promise.all(imgs.map(img => img.complete ? Promise.resolve() : new Promise(res => {
                            img.onload = () => res(null);
                            img.onerror = () => res(null);
                        })));
                    };
                    try { if (document.fonts && document.fonts.ready) { await document.fonts.ready; } } catch (e) {}
                    await waitForImages();
                    setTimeout(() => window.print(), 0);
                })();
            </script>
        </body>
    </html>
    `;
};


export const ResultsDisplay: React.FC<ResultsDisplayProps> = ({ projectData, onReset, onSaveProject }) => {
    const [activeTab, setActiveTab] = useState<Tab>('bom');
    const [techPack, setTechPack] = useState<TechPack>(projectData.techPack);
    const [costEstimation, setCostEstimation] = useState<CostEstimation>(projectData.costEstimation);
    const [isDownloading, setIsDownloading] = useState(false);
    const [isTranslating, setIsTranslating] = useState(false);
    const [translationError, setTranslationError] = useState<string | null>(null);
    const [translationMenuOpen, setTranslationMenuOpen] = useState(false);
    const [selectedLanguage, setSelectedLanguage] = useState<string>('English');
    
    const frontSketchRef = useRef<AnnotatedSketchHandles>(null);
    const backSketchRef = useRef<AnnotatedSketchHandles>(null);
    const liningSketchRef = useRef<AnnotatedSketchHandles>(null);

    const { front, back, lining } = projectData.technicalSketches;
    const hasLining = !!lining;
    
    const allSketchesData = {
        front: { id: 'front', sketchData: front, title: 'Front View', filename: 'technical-sketch-front.png', ref: frontSketchRef },
        back: { id: 'back', sketchData: back, title: 'Back View', filename: 'technical-sketch-back.png', ref: backSketchRef },
        ...(hasLining && lining && { lining: { id: 'lining', sketchData: lining, title: 'Lining View', filename: 'technical-sketch-lining.png', ref: liningSketchRef } })
    };

    const initialOrder = ['front', 'back', ...(hasLining ? ['lining'] : [])];
    const [sketchOrder, setSketchOrder] = useState(initialOrder);
    const [sketchView, setSketchView] = useState<'front' | 'back'>('front');

    // When a new project is loaded, we need to reset all local state
    useEffect(() => {
        setTechPack(projectData.techPack);
        setCostEstimation(projectData.costEstimation);
        const newOrder = ['front', 'back', ...(projectData.technicalSketches.lining ? ['lining'] : [])];
        setSketchOrder(newOrder);
    }, [projectData]);

    const visualConceptsCount = projectData.visualConcepts.length;

    // Recalculate total cost when breakdown changes
    useEffect(() => {
        const total = costEstimation.costBreakdown.reduce((sum, item) => sum + (Number(item.cost) || 0), 0);
        setCostEstimation(prev => ({...prev, totalEstimatedCost: total}));
    }, [costEstimation.costBreakdown]);

    const handleTechPackChange = <T extends keyof TechPack>(field: T, value: TechPack[T]) => {
        setTechPack(prev => ({ ...prev, [field]: value }));
    };

    const handleArrayChange = (arrayName: 'billOfMaterials' | 'specSheet' | 'constructionDetails', index: number, value: any) => {
        const updatedArray = [...techPack[arrayName]];
        updatedArray[index] = value;
        setTechPack(prev => ({ ...prev, [arrayName]: updatedArray }));
    };

    const handleItemAdd = (arrayName: 'billOfMaterials' | 'specSheet' | 'constructionDetails') => {
        let newItem: any;
        if (arrayName === 'billOfMaterials') newItem = { item: 'New Item', description: 'Description' };
        else if (arrayName === 'specSheet') newItem = { pointOfMeasure: 'New POM', measurement: '0 inches' };
        else newItem = 'New construction detail.';
        
        setTechPack(prev => ({ ...prev, [arrayName]: [...prev[arrayName], newItem] }));
    };

    const handleItemRemove = (arrayName: 'billOfMaterials' | 'specSheet' | 'constructionDetails', index: number) => {
        const updatedArray = techPack[arrayName].filter((_, i) => i !== index);
        setTechPack(prev => ({ ...prev, [arrayName]: updatedArray }));
    };

    const languageOptions = ['English', '中文', 'Español', 'Français', '日本語'];
    const activeSketchRef = sketchView === 'back' ? backSketchRef : frontSketchRef;

    const handleTranslateAllViews = async (language: string) => {
        const refs = [frontSketchRef.current, backSketchRef.current].filter(Boolean) as AnnotatedSketchHandles[];
        setTranslationMenuOpen(false);
        setSelectedLanguage(language);
        setIsTranslating(true);
        setTranslationError(null);
        try {
            for (const ref of refs) {
                await ref.translateAll(language);
            }
        } catch (err) {
            console.error('Translate annotations failed:', err);
            setTranslationError(err instanceof Error ? err.message : 'Translation failed.');
        } finally {
            setIsTranslating(false);
        }
    };

     const handleCostBreakdownChange = (index: number, value: CostBreakdownItem) => {
        const updatedArray = [...costEstimation.costBreakdown];
        updatedArray[index] = value;
        setCostEstimation(prev => ({ ...prev, costBreakdown: updatedArray }));
    };

    const handleCostItemAdd = () => {
        const newItem: CostBreakdownItem = { item: 'New Cost Item', consumption: '1', unitPrice: '0', cost: 0 };
        setCostEstimation(prev => ({ ...prev, costBreakdown: [...prev.costBreakdown, newItem] }));
    };

    const handleCostItemRemove = (index: number) => {
        const updatedArray = costEstimation.costBreakdown.filter((_, i) => i !== index);
        setCostEstimation(prev => ({ ...prev, costBreakdown: updatedArray }));
    };
    
    const handleRecalculate = useCallback(() => {
        const newBreakdown = costEstimation.costBreakdown.map(item => {
            const consumptionVal = parseFloat(item.consumption);
            const unitPriceVal = parseFloat(item.unitPrice);

            // Only recalculate if both consumption and unit price are valid numbers
            if (!isNaN(consumptionVal) && !isNaN(unitPriceVal)) {
                return { ...item, cost: consumptionVal * unitPriceVal };
            }
            // Otherwise, return the item as is (user might have manually set the cost)
            return item;
        });
        setCostEstimation(prev => ({ ...prev, costBreakdown: newBreakdown }));
    }, [costEstimation.costBreakdown]);
    
    const handleExportToPdf = async () => {
        setIsDownloading(true);
        try {
            const orderedSketchRefs = sketchOrder.map(key => allSketchesData[key as keyof typeof allSketchesData]);
            const htmlContent = await createPdfHtml(projectData, techPack, costEstimation, orderedSketchRefs);

            const printWindow = window.open('', '_blank');
            if (printWindow) {
                printWindow.document.write(htmlContent);
                printWindow.document.close();
                printWindow.focus();
            } else {
                 alert("Could not open a new window. Please disable your popup blocker for this site.");
            }
        } catch (error) {
            console.error("Failed to generate PDF package:", error);
            alert("An error occurred while generating the PDF. Please check the console for details.");
        } finally {
            setIsDownloading(false);
        }
    };

    // Drag and Drop Handlers
    const dragItem = useRef<number | null>(null);
    const dragOverItem = useRef<number | null>(null);

    const handleDragStart = (e: React.DragEvent<HTMLDivElement>, index: number) => {
        dragItem.current = index;
        e.dataTransfer.effectAllowed = 'move';
        e.currentTarget.classList.add('dragging'); 
    };

    const handleDragEnter = (e: React.DragEvent<HTMLDivElement>, index: number) => {
        if (dragItem.current === index) return;
        dragOverItem.current = index;
        document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
        e.currentTarget.classList.add('drag-over');
    };
    
    const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
        e.currentTarget.classList.remove('drag-over');
    };

    const handleDrop = () => {
        if (dragItem.current !== null && dragOverItem.current !== null) {
            const newSketchOrder = [...sketchOrder];
            const dragItemContent = newSketchOrder.splice(dragItem.current, 1)[0];
            newSketchOrder.splice(dragOverItem.current, 0, dragItemContent);
            
            setSketchOrder(newSketchOrder);
        }
        dragItem.current = null;
        dragOverItem.current = null;
        document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    };

    const handleDragEnd = (e: React.DragEvent<HTMLDivElement>) => {
        e.currentTarget.classList.remove('dragging');
        document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    };


    return (
        <div className="space-y-8 animate-fade-in">
            <div className="flex flex-col md:flex-row justify-between md:items-center gap-4">
                 <div>
                    <h2 className="text-2xl font-bold text-gray-900">Your Generated Design Package</h2>
                    <p className="text-gray-600 mt-1 max-w-2xl italic">"{projectData.prompt}"</p>
                </div>
                <div className="flex space-x-2 flex-shrink-0">
                    <button 
                        onClick={() => onSaveProject(techPack, costEstimation)} 
                        className="flex items-center justify-center bg-white text-gray-700 font-semibold py-2 px-4 rounded-md border border-gray-300 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition duration-150 ease-in-out"
                    >
                        <SaveIcon className="w-5 h-5 mr-2" />
                        Save Project
                    </button>
                    <button onClick={onReset} className="flex items-center justify-center bg-white text-gray-700 font-semibold py-2 px-4 rounded-md border border-gray-300 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition duration-150 ease-in-out">
                        <RedoIcon className="w-5 h-5 mr-2" />
                        New Design
                    </button>
                    <button 
                        onClick={handleExportToPdf}
                        disabled={isDownloading}
                        className="flex items-center justify-center bg-indigo-600 text-white font-semibold py-2 px-4 rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition duration-150 ease-in-out disabled:bg-indigo-400 disabled:cursor-not-allowed"
                    >
                        <DownloadIcon className="w-5 h-5 mr-2" />
                        {isDownloading ? 'Generating...' : 'Export to PDF'}
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <SectionCard title={visualConceptsCount > 1 ? "Visual Concepts" : "Visual Concept"}>
                    <div className={`grid grid-cols-1 ${visualConceptsCount > 1 ? 'md:grid-cols-2' : ''} gap-4`}>
                        {projectData.visualConcepts.map((img, index) => (
                            <img key={index} src={`data:image/jpeg;base64,${img}`} alt={`Visual Concept ${index + 1}`} className="rounded-lg object-cover w-full h-auto shadow-sm" />
                        ))}
                    </div>
                </SectionCard>
                <SectionCard
                    title="2D Technical Sketches"
                    actions={
                        <div className="flex items-center space-x-2">
                            <div className="relative">
                                <button
                                    onClick={() => setTranslationMenuOpen(prev => !prev)}
                                    className="px-3 py-1 text-sm font-medium border border-indigo-200 bg-white text-indigo-700 rounded-md hover:bg-indigo-50 disabled:bg-indigo-100"
                                    disabled={isTranslating}
                                >
                                    {isTranslating ? 'Translating…' : `Translate (${selectedLanguage})`}
                                </button>
                                {translationMenuOpen && (
                                    <div className="absolute z-10 mt-2 bg-white border border-gray-200 rounded-md shadow-lg py-2 text-sm">
                                        <div className="flex flex-col">
                                            {languageOptions.map((lang) => (
                                                <button
                                                    key={lang}
                                                    onClick={() => handleTranslateAllViews(lang)}
                                                    className="px-4 py-2 text-left hover:bg-gray-100 text-gray-700"
                                                >
                                                    {lang}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                            <div className="inline-flex rounded-md shadow-sm">
                                {['front', 'back'].map((view) => (
                                    <button
                                        key={view}
                                        onClick={() => setSketchView(view as 'front' | 'back')}
                                        className={`px-3 py-1 text-sm font-medium border ${sketchView === view ? 'bg-indigo-100 text-indigo-700 border-indigo-200' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-100'}`}
                                    >
                                        {view === 'front' ? 'Front' : 'Back'}
                                    </button>
                                ))}
                            </div>
                        </div>
                    }
                >
                    <div className="flex justify-center items-center p-2 mb-4 bg-blue-50 text-blue-700 border border-blue-200 rounded-md text-sm">
                        <InfoIcon className="w-5 h-5 mr-2 flex-shrink-0" />
                        <p>Drag the handle to reorder sketches. Click text to edit or drag annotations to move.</p>
                    </div>
                    {translationError && (
                        <p className="text-sm text-red-600 mb-2">{translationError}</p>
                    )}
                    <div className="grid grid-cols-1 gap-4">
                        {sketchOrder.map((key, index) => {
                            const sketch = allSketchesData[key as keyof typeof allSketchesData];
                            if (!sketch) return null;
                            return (
                                <div
                                    key={key}
                                    draggable
                                    onDragStart={(e) => handleDragStart(e, index)}
                                    onDragEnter={(e) => handleDragEnter(e, index)}
                                    onDragLeave={handleDragLeave}
                                    onDragOver={(e) => e.preventDefault()}
                                    onDrop={handleDrop}
                                    onDragEnd={handleDragEnd}
                                    className={`p-2 rounded-lg transition-all duration-200 ${sketchView !== key ? 'hidden' : ''}`}
                                >
                                    <div className="flex justify-center items-center text-gray-300 hover:text-gray-500 cursor-move py-1">
                                        <GripVerticalIcon className="w-6 h-6" />
                                    </div>
                                    <AnnotatedSketch
                                        ref={sketch.ref as React.Ref<AnnotatedSketchHandles>}
                                        sketchData={sketch.sketchData}
                                        title={sketch.title}
                                        filename={sketch.filename}
                                    />
                                </div>
                            );
                        })}
                    </div>
                </SectionCard>
            </div>
            
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <SectionCard title="Production Tech Pack" className="col-span-1">
                    <div className="p-0">
                        <div className="px-6 pb-4">
                            <EditableField
                                as="textarea"
                                initialValue={techPack.description}
                                onSave={(value) => handleTechPackChange('description', value)}
                                className="text-gray-700"
                            />
                        </div>
                        <div className="border-b border-gray-200">
                            <nav className="-mb-px flex space-x-6 px-6" aria-label="Tabs">
                                <button onClick={() => setActiveTab('bom')} className={`${activeTab === 'bom' ? 'border-indigo-500 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'} whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm`}>Bill of Materials</button>
                                <button onClick={() => setActiveTab('specs')} className={`${activeTab === 'specs' ? 'border-indigo-500 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'} whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm`}>Measurement Specs</button>
                                <button onClick={() => setActiveTab('construction')} className={`${activeTab === 'construction' ? 'border-indigo-500 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'} whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm`}>Construction Details</button>
                            </nav>
                        </div>
                        <div className="pt-6">
                            {activeTab === 'bom' && (
                                 <div className="overflow-x-auto">
                                    <table className="w-full text-sm text-left text-gray-600">
                                        <thead className="text-xs text-gray-700 uppercase bg-gray-100">
                                            <tr>
                                                <th scope="col" className="px-6 py-3">Item</th>
                                                <th scope="col" className="px-6 py-3">Description</th>
                                                <th scope="col" className="px-6 py-3 sr-only">Actions</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {techPack.billOfMaterials.map((row, index) => (
                                                <tr key={index} className="bg-white border-b hover:bg-gray-50 group">
                                                    <td className="px-6 py-2 w-1/3"><EditableField initialValue={row.item} onSave={(val) => handleArrayChange('billOfMaterials', index, { ...row, item: val })} /></td>
                                                    <td className="px-6 py-2 w-2/3"><EditableField initialValue={row.description} onSave={(val) => handleArrayChange('billOfMaterials', index, { ...row, description: val })} /></td>
                                                    <td className="px-6 py-2 text-right">
                                                        <button onClick={() => handleItemRemove('billOfMaterials', index)} className="text-gray-400 hover:text-red-600 opacity-0 group-hover:opacity-100">
                                                            <TrashIcon className="w-4 h-4" />
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                    <button onClick={() => handleItemAdd('billOfMaterials')} className="flex items-center text-indigo-600 font-semibold hover:text-indigo-800 p-4 text-sm">
                                        <PlusCircleIcon className="w-5 h-5 mr-2" /> Add Item
                                    </button>
                                </div>
                            )}
                            {activeTab === 'specs' && (
                                 <div className="overflow-x-auto">
                                    <table className="w-full text-sm text-left text-gray-600">
                                        <thead className="text-xs text-gray-700 uppercase bg-gray-100">
                                            <tr>
                                                <th scope="col" className="px-6 py-3">Point of Measure</th>
                                                <th scope="col" className="px-6 py-3">Measurement (Size M)</th>
                                                 <th scope="col" className="px-6 py-3 sr-only">Actions</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {techPack.specSheet.map((row, index) => (
                                                <tr key={index} className="bg-white border-b hover:bg-gray-50 group">
                                                    <td className="px-6 py-2"><EditableField initialValue={row.pointOfMeasure} onSave={(val) => handleArrayChange('specSheet', index, { ...row, pointOfMeasure: val })} /></td>
                                                    <td className="px-6 py-2"><EditableField initialValue={row.measurement} onSave={(val) => handleArrayChange('specSheet', index, { ...row, measurement: val })} /></td>
                                                    <td className="px-6 py-2 text-right">
                                                        <button onClick={() => handleItemRemove('specSheet', index)} className="text-gray-400 hover:text-red-600 opacity-0 group-hover:opacity-100">
                                                            <TrashIcon className="w-4 h-4" />
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                    <button onClick={() => handleItemAdd('specSheet')} className="flex items-center text-indigo-600 font-semibold hover:text-indigo-800 p-4 text-sm">
                                        <PlusCircleIcon className="w-5 h-5 mr-2" /> Add Measurement
                                    </button>
                                </div>
                            )}
                            {activeTab === 'construction' && (
                                 <div className="px-6">
                                     <ul className="space-y-2 text-gray-700">
                                        {techPack.constructionDetails.map((detail, index) => (
                                            <li key={index} className="flex items-center group">
                                                <span className="mr-2">&bull;</span>
                                                <EditableField initialValue={detail} onSave={(val) => handleArrayChange('constructionDetails', index, val)} className="flex-grow"/>
                                                 <button onClick={() => handleItemRemove('constructionDetails', index)} className="ml-4 text-gray-400 hover:text-red-600 opacity-0 group-hover:opacity-100">
                                                    <TrashIcon className="w-4 h-4" />
                                                </button>
                                            </li>
                                        ))}
                                    </ul>
                                     <button onClick={() => handleItemAdd('constructionDetails')} className="flex items-center text-indigo-600 font-semibold hover:text-indigo-800 mt-4 text-sm">
                                        <PlusCircleIcon className="w-5 h-5 mr-2" /> Add Detail
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                </SectionCard>
                 <SectionCard 
                    title="Cost Estimation" 
                    icon={<CalculatorIcon className="w-5 h-5 text-gray-500" />}
                    actions={
                        <button onClick={handleRecalculate} className="flex items-center text-sm font-semibold text-indigo-600 hover:text-indigo-800 transition-colors" title="Recalculate costs based on consumption and unit price">
                            <RefreshIcon className="w-4 h-4 mr-1" />
                            Recalculate
                        </button>
                    }
                >
                     <div className="space-y-4">
                        <div className="flex justify-between items-center bg-gray-50 p-3 rounded-md">
                            <span className="font-medium text-gray-600">Garment Type: <span className="text-indigo-600 font-semibold">{costEstimation.garmentType}</span></span>
                             <div className="text-right">
                                <p className="text-sm text-gray-500">Total Estimated Cost</p>
                                <p className="text-2xl font-bold text-gray-800">{costEstimation.totalEstimatedCost.toFixed(2)} RMB (人民币)</p>
                            </div>
                        </div>
                        <div className="overflow-x-auto">
                             <table className="w-full text-sm text-left text-gray-600">
                                <thead className="text-xs text-gray-700 uppercase bg-gray-100">
                                    <tr>
                                        <th className="px-4 py-2">Item</th>
                                        <th className="px-4 py-2">Consumption (面料单耗)</th>
                                        <th className="px-4 py-2">Unit Price (面料单价)</th>
                                        <th className="px-4 py-2 text-right">Cost (RMB)</th>
                                        <th className="px-4 py-2 sr-only">Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {costEstimation.costBreakdown.map((row, index) => (
                                        <tr key={index} className="bg-white border-b hover:bg-gray-50 group">
                                            <td className="px-4 py-2 w-1/4"><EditableField initialValue={row.item} onSave={(val) => handleCostBreakdownChange(index, { ...row, item: val })} /></td>
                                            <td className="px-4 py-2 w-1/4"><EditableField initialValue={row.consumption} onSave={(val) => handleCostBreakdownChange(index, { ...row, consumption: val })} /></td>
                                            <td className="px-4 py-2 w-1/4"><EditableField initialValue={row.unitPrice} onSave={(val) => handleCostBreakdownChange(index, { ...row, unitPrice: val })} /></td>
                                            <td className="px-4 py-2 w-1/4 text-right"><EditableField initialValue={row.cost.toFixed(2)} onSave={(val) => handleCostBreakdownChange(index, { ...row, cost: parseFloat(val) || 0 })} /></td>
                                             <td className="px-4 py-2 text-right">
                                                <button onClick={() => handleCostItemRemove(index)} className="text-gray-400 hover:text-red-600 opacity-0 group-hover:opacity-100">
                                                    <TrashIcon className="w-4 h-4" />
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                             </table>
                             <button onClick={handleCostItemAdd} className="flex items-center text-indigo-600 font-semibold hover:text-indigo-800 p-4 text-sm">
                                <PlusCircleIcon className="w-5 h-5 mr-2" /> Add Cost Item
                            </button>
                        </div>

                         {costEstimation.notes.length > 0 && (
                            <div>
                                <h4 className="font-semibold text-gray-700 mb-2 text-sm">Notes & Assumptions</h4>
                                <ul className="space-y-1 text-sm text-gray-600 list-disc list-inside bg-yellow-50 p-3 rounded-md border border-yellow-200">
                                    {costEstimation.notes.map((note, index) => <li key={index}>{note}</li>)}
                                </ul>
                            </div>
                        )}
                    </div>
                </SectionCard>
            </div>
        </div>
    );
};
