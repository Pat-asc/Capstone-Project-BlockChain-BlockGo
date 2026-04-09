import React, { useState } from 'react';

const DownloadGradingSheetButton = ({ department, section }) => {
  const [isDownloading, setIsDownloading] = useState(false);

  const handleDownload = async () => {
    if (!department || !section) {
      alert("Department and section are required to download the grading sheet.");
      return;
    }

    setIsDownloading(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/GradeTemplate/department/${department}/section/${section}/download`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || 'Failed to download the grading sheet.');
      }

      // Convert the response stream into a binary Blob
      const blob = await response.blob();

      // Create a temporary local URL that points to the Blob
      const downloadUrl = window.URL.createObjectURL(blob);

      // Create a hidden <a> tag and click it to trigger the browser's download prompt
      const link = document.createElement('a');
      link.href = downloadUrl;
      
      const safeSection = section.replace(/[^a-z0-9]/gi, '_');
      link.setAttribute('download', `${department}_Sec_${safeSection}_Grades.xlsx`);

      document.body.appendChild(link);
      link.click();

      // Clean up the DOM and release the Blob memory
      link.parentNode.removeChild(link);
      window.URL.revokeObjectURL(downloadUrl);

    } catch (error) {
      console.error("Error downloading grading sheet:", error);
      alert(`Error: ${error.message}`);
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <button onClick={handleDownload} disabled={isDownloading} className="btn-download" style={{ backgroundColor: '#28a745', color: 'white', padding: '10px', border: 'none', borderRadius: '5px', cursor: 'pointer' }}>
      {isDownloading ? 'Generating Sheet...' : 'Download Grading Sheet'}
    </button>
  );
};

export default DownloadGradingSheetButton;