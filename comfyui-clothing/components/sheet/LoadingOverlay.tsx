
import React from 'react';

interface LoadingOverlayProps {
    message: string;
}

const LoadingSpinner: React.FC = () => (
    <svg className="animate-spin h-8 w-8 text-indigo-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
    </svg>
);

export const LoadingOverlay: React.FC<LoadingOverlayProps> = ({ message }) => {
    return (
        <div className="fixed inset-0 bg-white bg-opacity-75 flex flex-col items-center justify-center z-50 transition-opacity">
            <div className="text-center p-8 bg-white rounded-lg shadow-xl">
                <LoadingSpinner />
                <p className="mt-4 text-lg font-semibold text-gray-700">{message || 'Processing your design...'}</p>
                <p className="mt-1 text-sm text-gray-500">This may take a moment.</p>
            </div>
        </div>
    );
};