
import React from 'react';
import { AlertTriangleIcon } from './IconComponents';

interface ErrorDisplayProps {
    message: string;
    onClear: () => void;
}

export const ErrorDisplay: React.FC<ErrorDisplayProps> = ({ message, onClear }) => {
    return (
        <div className="max-w-3xl mx-auto my-4 bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-lg relative" role="alert">
            <div className="flex">
                <div className="py-1">
                    <AlertTriangleIcon className="h-6 w-6 text-red-500 mr-4"/>
                </div>
                <div>
                    <strong className="font-bold">Error!</strong>
                    <span className="block sm:inline ml-2">{message}</span>
                </div>
            </div>
            <button onClick={onClear} className="absolute top-0 bottom-0 right-0 px-4 py-3">
                <svg className="fill-current h-6 w-6 text-red-500" role="button" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><title>Close</title><path d="M14.348 14.849a1.2 1.2 0 0 1-1.697 0L10 11.819l-2.651 3.029a1.2 1.2 0 1 1-1.697-1.697l2.758-3.15-2.759-3.152a1.2 1.2 0 1 1 1.697-1.697L10 8.183l2.651-3.031a1.2 1.2 0 1 1 1.697 1.697l-2.758 3.152 2.758 3.15a1.2 1.2 0 0 1 0 1.698z"/></svg>
            </button>
        </div>
    );
};