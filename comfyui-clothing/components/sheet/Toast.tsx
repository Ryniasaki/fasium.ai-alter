
import React from 'react';
import { CheckCircleIcon } from './IconComponents';

interface ToastProps {
    message: string;
}

export const Toast: React.FC<ToastProps> = ({ message }) => {
    return (
        <div 
            className="fixed bottom-5 right-5 flex items-center w-full max-w-xs p-4 space-x-4 text-gray-600 bg-white rounded-lg shadow-lg animate-fade-in-up z-50"
            role="alert"
        >
            <CheckCircleIcon className="w-6 h-6 text-green-500" />
            <div className="pl-4 text-sm font-semibold">{message}</div>
        </div>
    );
};