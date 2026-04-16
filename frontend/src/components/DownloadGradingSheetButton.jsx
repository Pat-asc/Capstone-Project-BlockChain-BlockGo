import React, { useState } from 'react';
import { downloadGradingSheet } from '../services/api';

const DownloadGradingSheetButton = ({ department, section }) => {
    const [isDownloading, setIsDownloading] = useState(false);

    const handleDownload = async () => {
        setIsDownloading(true);
        try {
            // This leverages api.js to correctly route to port 5000 and attach the JWT
            await downloadGradingSheet(department, section);
        } catch (error) {
            alert(`Download Error: ${error.message}`);
        } finally {
            setIsDownloading(false);
        }
    };

    return (
        <button 
            className="upload-label" 
            style={{ 
                backgroundColor: '#0d6efd', 
                color: 'white', 
                border: 'none', 
                cursor: isDownloading ? 'not-allowed' : 'pointer',
                opacity: isDownloading ? 0.7 : 1
            }} 
            onClick={handleDownload}
            disabled={isDownloading}
        >
            {isDownloading ? 'Downloading...' : 'Download Grading Sheet'}
        </button>
    );
};

export default DownloadGradingSheetButton;
