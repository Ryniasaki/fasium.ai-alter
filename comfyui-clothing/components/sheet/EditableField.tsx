
import React, { useState, useRef, useEffect } from 'react';

interface EditableFieldProps {
    initialValue: string;
    onSave: (value: string) => void;
    as?: 'input' | 'textarea';
    className?: string;
    style?: React.CSSProperties;
}

export const EditableField: React.FC<EditableFieldProps> = ({ initialValue, onSave, as = 'input', className = '', style }) => {
    const [isEditing, setIsEditing] = useState(false);
    const [value, setValue] = useState(initialValue);
    const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);

    useEffect(() => {
        setValue(initialValue);
    }, [initialValue]);

    useEffect(() => {
        if (isEditing) {
            inputRef.current?.focus();
            inputRef.current?.select();
        }
    }, [isEditing]);
    
    const handleSave = () => {
        if (value.trim() !== initialValue.trim()) {
            onSave(value.trim());
        }
        setIsEditing(false);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && as === 'input') {
            handleSave();
        } else if (e.key === 'Escape') {
            setValue(initialValue);
            setIsEditing(false);
        }
    };

    if (isEditing) {
         if (as === 'textarea') {
            return (
                <textarea
                    ref={inputRef as React.Ref<HTMLTextAreaElement>}
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    onBlur={handleSave}
                    onKeyDown={handleKeyDown}
                    className={`w-full p-2 border border-indigo-300 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition duration-150 ease-in-out text-base ${className}`}
                    rows={4}
                    style={style}
                />
            );
        }
        return (
            <input
                ref={inputRef as React.Ref<HTMLInputElement>}
                type="text"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onBlur={handleSave}
                onKeyDown={handleKeyDown}
                className={`w-full p-1 border border-indigo-300 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition duration-150 ease-in-out text-base ${className}`}
                style={style}
            />
        );
    }
    
    return (
        <div onClick={() => setIsEditing(true)} className={`cursor-pointer w-full hover:bg-indigo-50 p-1 rounded-md -m-1 ${className}`} style={style}>
            {value || <span className="text-gray-400 italic">Click to edit...</span>}
        </div>
    );
};