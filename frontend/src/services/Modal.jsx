import React from 'react';

const Modal = ({ isOpen, onClose, title, children }) => {
    if (!isOpen) return null;

    return (
        <div 
            className="fixed inset-0 z-[1001] flex items-center justify-center bg-black bg-opacity-50 p-4 backdrop-blur-sm"
            onClick={onClose}
        >
            <div 
                className="relative max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-4 shadow-2xl sm:p-6"
                onClick={e => e.stopPropagation()}
            >
                <div className="mb-4 flex items-center justify-between gap-3 border-b border-slate-200 pb-4">
                    <h3 className="text-lg font-bold text-[#003366] sm:text-xl">{title}</h3>
                    <button 
                        onClick={onClose} 
                        className="text-3xl leading-none text-slate-400 transition hover:text-slate-600"
                    >
                        &times;
                    </button>
                </div>
                <div>{children}</div>
            </div>
        </div>
    );
};

export default Modal;
