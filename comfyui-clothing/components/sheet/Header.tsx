
import React from 'react';
import { ScissorIcon, FolderOpenIcon } from './IconComponents';

interface HeaderProps {
    onLoadProject: () => void;
}

export const Header: React.FC<HeaderProps> = ({ onLoadProject }) => {
    return (
        <header className="bg-white border-b border-gray-200">
            <div className="container mx-auto px-4 md:px-8">
                <div className="flex items-center justify-between h-16">
                    <div className="flex items-center space-x-3">
                        <ScissorIcon className="h-8 w-8 text-indigo-600" />
                        <span className="text-xl font-bold text-gray-800">AI Fashion Design Assistant</span>
                    </div>
                    <div>
                        <button 
                            onClick={onLoadProject} 
                            className="flex items-center justify-center bg-white text-gray-700 font-semibold py-2 px-4 rounded-md border border-gray-300 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition duration-150 ease-in-out"
                        >
                            <FolderOpenIcon className="w-5 h-5 mr-2" />
                            Load Project
                        </button>
                    </div>
                </div>
            </div>
        </header>
    );
};