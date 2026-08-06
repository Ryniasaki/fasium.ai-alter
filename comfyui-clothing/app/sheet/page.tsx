'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { CostEstimation, DesignBrief, ProjectData, TechPack } from './types';
import { DesignInputForm } from './components/DesignInputForm';
import { DesignOptionsSelector } from './components/DesignOptionsSelector';
import { ErrorDisplay } from './components/ErrorDisplay';
import { Header } from './components/Header';
import { LoadingOverlay } from './components/LoadingOverlay';
import { ResultsDisplay } from './components/ResultsDisplay';
import { Toast } from './components/Toast';
import {
  generateCostEstimation,
  generateLiningSketch,
  generateProductionPackageData,
  generateTechnicalSketches,
  generateVisualConcepts,
} from './services/geminiService';

const SHEET_PREFILL_KEY = "sheet_prefill_image"
const SHEET_PREFILL_EVENT = "sheet-prefill"

const SheetPage = () => {
  const [originalBrief, setOriginalBrief] = useState<DesignBrief | null>(null);
  const [designOptions, setDesignOptions] = useState<string[] | null>(null);
  const [projectData, setProjectData] = useState<ProjectData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!toastMessage) return;
    const timer = setTimeout(() => setToastMessage(null), 3000);
    return () => clearTimeout(timer);
  }, [toastMessage]);

  const handleInitialGenerate = useCallback(async (brief: DesignBrief) => {
    if (!brief.description) {
      setError('Please enter a design description.');
      return;
    }

    setIsLoading(true);
    setError(null);
    setProjectData(null);
    setDesignOptions(null);
    setOriginalBrief(brief);

    try {
      if (brief.designImages && brief.designImages.length > 0) {
        setLoadingMessage('Step 1 of 4: Generating visual concept...');
        const visualConceptsPromise = generateVisualConcepts(brief, 1);

        setLoadingMessage('Step 2 of 4: Drafting technical sketches...');
        const technicalSketchesPromise = generateTechnicalSketches(brief);
        const liningSketchPromise = generateLiningSketch(brief);

        setLoadingMessage('Step 3 of 4: Compiling production package...');
        const productionPackagePromise = generateProductionPackageData(brief);

        const [visualsResult, sketchesResult, liningResult, techPackResult] = await Promise.all([
          visualConceptsPromise,
          technicalSketchesPromise,
          liningSketchPromise,
          productionPackagePromise,
        ]);

        setLoadingMessage('Step 4 of 4: Estimating production cost...');
        const costEstimationResult = await generateCostEstimation(brief, techPackResult);

        setProjectData({
          prompt: brief.description,
          visualConcepts: visualsResult,
          technicalSketches: { ...sketchesResult, lining: liningResult },
          techPack: techPackResult,
          costEstimation: costEstimationResult,
        });
      } else {
        setLoadingMessage('Generating design options...');
        const options = await generateVisualConcepts(brief, 4);
        setDesignOptions(options);
      }
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? `An error occurred: ${err.message}` : 'An unknown error occurred.');
    } finally {
      setIsLoading(false);
      setLoadingMessage('');
    }
  }, []);

  const handleSelectDesign = useCallback(
    async (selectedImage: string) => {
      if (!originalBrief) {
        setError('An unexpected error occurred: original design brief is missing.');
        return;
      }

      setIsLoading(true);
      setError(null);
      setDesignOptions(null);

      const newBrief: DesignBrief = {
        ...originalBrief,
        designImages: [{ mimeType: 'image/jpeg', data: selectedImage }],
      };

      try {
        setLoadingMessage('Step 1 of 4: Finalizing visual concept...');
        const visualConcept = [selectedImage];

        setLoadingMessage('Step 2 of 4: Drafting technical sketches...');
        const technicalSketchesPromise = generateTechnicalSketches(newBrief);
        const liningSketchPromise = generateLiningSketch(newBrief);

        setLoadingMessage('Step 3 of 4: Compiling production package...');
        const productionPackagePromise = generateProductionPackageData(newBrief);

        const [sketchesResult, liningResult, techPackResult] = await Promise.all([
          technicalSketchesPromise,
          liningSketchPromise,
          productionPackagePromise,
        ]);

        setLoadingMessage('Step 4 of 4: Estimating production cost...');
        const costEstimationResult = await generateCostEstimation(newBrief, techPackResult);

        setProjectData({
          prompt: originalBrief.description,
          visualConcepts: visualConcept,
          technicalSketches: { ...sketchesResult, lining: liningResult },
          techPack: techPackResult,
          costEstimation: costEstimationResult,
        });
      } catch (err) {
        console.error(err);
        setError(err instanceof Error ? `An error occurred: ${err.message}` : 'An unknown error occurred.');
      } finally {
        setIsLoading(false);
        setLoadingMessage('');
      }
    },
    [originalBrief],
  );

  const handleBackToBrief = useCallback(() => {
    setDesignOptions(null);
  }, []);

  const handleStartOver = useCallback(() => {
    setProjectData(null);
    setError(null);
    setIsLoading(false);
    setDesignOptions(null);
    setOriginalBrief(null);
  }, []);

  const handleSaveProject = useCallback(
    (editableTechPack: TechPack, editableCostEstimation: CostEstimation) => {
      if (!projectData) return;
      try {
        const savedProjectData: ProjectData = {
          ...projectData,
          techPack: editableTechPack,
          costEstimation: editableCostEstimation,
        };
        const blob = new Blob([JSON.stringify(savedProjectData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'fashion_project.json';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        setToastMessage('Project exported as file.');
      } catch (storageError) {
        console.error('Failed to save project:', storageError);
        setError('Could not export project.');
      }
    },
    [projectData],
  );

  const handleLoadProjectClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileSelected = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = reader.result?.toString() || '';
        const savedProjectData: ProjectData = JSON.parse(text);
        setProjectData(savedProjectData);
        setOriginalBrief(null);
        setDesignOptions(null);
        setError(null);
        setToastMessage('Project loaded from file.');
      } catch (err) {
        console.error('Failed to load project file:', err);
        setError('Could not load project file. The file might be invalid.');
      } finally {
        event.target.value = '';
      }
    };
    reader.onerror = () => {
      setError('Failed to read project file.');
      event.target.value = '';
    };
    reader.readAsText(file);
  }, []);

  const loadPrefillDesign = useCallback(async (imageUrl: string) => {
    try {
      const response = await fetch(imageUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch image: ${response.status}`);
      }
      const blob = await response.blob();
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string | null;
        if (!result) return;
        const [meta, data] = result.split(",");
        const mimeType = meta?.split(":")[1]?.split(";")[0] || "image/png";
        setOriginalBrief({
          description: "",
          designImages: [{ mimeType, data }],
          materials: [],
        });
        setDesignOptions(null);
        setProjectData(null);
        setError(null);
      };
      reader.readAsDataURL(blob);
    } catch (prefillError) {
      console.error("Failed to load sheet prefill:", prefillError);
      setError("无法加载版单图片，请稍后重试。");
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const stored = window.sessionStorage.getItem(SHEET_PREFILL_KEY);
    if (stored) {
      window.sessionStorage.removeItem(SHEET_PREFILL_KEY);
      try {
        const payload = JSON.parse(stored) as { imageUrl?: string | null };
        if (payload?.imageUrl) {
          void loadPrefillDesign(payload.imageUrl);
        }
      } catch (error) {
        console.error("Invalid sheet prefill payload:", error);
      }
    }

    const handlePrefillEvent = (event: Event) => {
      const detail = (event as CustomEvent<{ imageUrl?: string }>).detail;
      if (detail?.imageUrl) {
        void loadPrefillDesign(detail.imageUrl);
      }
    };

    window.addEventListener(SHEET_PREFILL_EVENT, handlePrefillEvent as EventListener);
    return () => window.removeEventListener(SHEET_PREFILL_EVENT, handlePrefillEvent as EventListener);
  }, [loadPrefillDesign]);

  const renderContent = () => {
    if (isLoading) return <LoadingOverlay message={loadingMessage} />;
    if (error) return <ErrorDisplay message={error} onClear={() => setError(null)} />;
    if (designOptions && originalBrief) {
      return (
        <DesignOptionsSelector
          options={designOptions}
          onSelect={handleSelectDesign}
          onBack={handleBackToBrief}
          prompt={originalBrief.description}
        />
      );
    }
    if (projectData) {
      return <ResultsDisplay projectData={projectData} onReset={handleStartOver} onSaveProject={handleSaveProject} />;
    }
    return <DesignInputForm onGenerate={handleInitialGenerate} disabled={isLoading} initialBrief={originalBrief} />;
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Header onLoadProject={handleLoadProjectClick} />
      <main className="container mx-auto p-4 md:p-8">{renderContent()}</main>
      <input
        ref={fileInputRef}
        type="file"
        accept="application/json"
        className="hidden"
        onChange={handleFileSelected}
      />
      {toastMessage && <Toast message={toastMessage} />}
    </div>
  );
};

export default SheetPage;
