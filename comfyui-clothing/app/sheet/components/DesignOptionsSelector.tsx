
import React from 'react';
import { CheckCircleIcon, BackIcon } from './IconComponents';

interface DesignOptionsSelectorProps {
    options: string[];
    onSelect: (selectedImage: string) => void;
    onBack: () => void;
    prompt: string;
}

export const DesignOptionsSelector: React.FC<DesignOptionsSelectorProps> = ({ options, onSelect, onBack, prompt }) => {
    return (
        <div className="max-w-6xl mx-auto animate-fade-in">
            <div className="text-center mb-8">
                <button onClick={onBack} className="text-indigo-600 font-semibold hover:text-indigo-800 transition-colors inline-flex items-center mb-4">
                    <BackIcon className="w-5 h-5 mr-2" />
                    Back to Edit Brief
                </button>
                <h2 className="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">Choose a Design Direction</h2>
                <p className="mt-4 text-lg text-gray-600">
                    Select your preferred concept based on your prompt: <em className="italic">"{prompt}"</em>
                </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                {options.map((img, index) => (
                    <div key={index} className="group relative rounded-lg overflow-hidden shadow-lg border border-gray-200 cursor-pointer" onClick={() => onSelect(img)}>
                        <img src={`data:image/jpeg;base64,${img}`} alt={`Design Option ${index + 1}`} className="w-full h-auto object-cover aspect-[3/4] transition-transform duration-300 group-hover:scale-105" />
                        <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-50 transition-all duration-300 flex items-center justify-center p-4">
                            <div className="text-white text-center opacity-0 group-hover:opacity-100 transition-opacity duration-300 transform group-hover:translate-y-0 translate-y-4">
                                <CheckCircleIcon className="w-12 h-12 mx-auto mb-2" />
                                <span className="font-bold text-lg">Select this Design</span>
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};