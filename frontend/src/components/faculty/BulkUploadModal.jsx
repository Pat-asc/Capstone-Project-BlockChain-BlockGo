import React, { useEffect, useState } from "react";

const BulkUploadModal = ({
  isOpen,
  onClose,
  sectionData,
  onUpload,
  systemTerm,
  isEncodingOpen = false,
}) => {
  const [activeTab, setActiveTab] = useState("paste");
  const [pasteText, setPasteText] = useState("");
  const [selectedFile, setSelectedFile] = useState(null);

  useEffect(() => {
    if (isOpen && !isEncodingOpen) {
      onClose?.();
    }
  }, [isEncodingOpen, isOpen, onClose]);

  if (!isOpen) return null;

  const handleDownloadTemplate = () => {
  const header =
    systemTerm === "midterm"
      ? "Student ID,Midterm Grade\n"
      : "Student ID,Finals Grade\n";

  const rows = sectionData.students
    .map((student) => `${student.id},`)
    .join("\n");

  const blob = new Blob([header + rows], { type: "text/csv" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = `${sectionData.sectionName}_${systemTerm}_template.csv`;
  a.click();

  URL.revokeObjectURL(url);
};

  const parseLinesToGrades = (text) => {
  const lines = text.split("\n");
  const parsed = {};

  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    const parts = trimmed.split(/[\s,]+/);

    if (parts.length >= 2) {
      const studentId = parts[0];
      const gradeValue = parts[1];

      parsed[studentId] = {
        [systemTerm]: ["INC", "UD", "D", "W"].includes(gradeValue.toUpperCase())
          ? gradeValue.toUpperCase()
          : gradeValue,
      };
    }
  });

  return parsed;
};

  const handleUpload = async () => {
    if (activeTab === "paste") {
      const parsed = parseLinesToGrades(pasteText);
      onUpload(parsed);
      onClose();
      return;
    }

    if (activeTab === "csv" && selectedFile) {
      const text = await selectedFile.text();
      const parsed = parseLinesToGrades(text);
      onUpload(parsed);
      onClose();
    }
  };

  const canUpload =
    activeTab === "paste" ? pasteText.trim().length > 0 : !!selectedFile;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
      <div className="w-full max-w-2xl rounded-2xl bg-white shadow-xl">
        <div className="p-4">
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setActiveTab("paste")}
              className={`rounded-xl border py-3 text-sm font-semibold ${
                activeTab === "paste"
                  ? "border-[#032d63] bg-[#032d63] text-white"
                  : "bg-white text-slate-700"
              }`}
            >
              Paste Text
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("csv")}
              className={`rounded-xl border py-3 text-sm font-semibold ${
                activeTab === "csv"
                  ? "border-[#032d63] bg-[#032d63] text-white"
                  : "bg-white text-slate-700"
              }`}
            >
              Upload CSV
            </button>
          </div>
        </div>

        <div className="px-4">
          <div className="rounded-xl border-l-4 border-blue-500 bg-slate-100 p-4">
            <div className="flex gap-3">
              <div className="text-blue-700">ⓘ</div>

              <div className="text-sm text-blue-800">
                <h3 className="mb-2 font-bold">Format Instructions:</h3>

                <p>Each line: Student ID,{" "}{systemTerm === "midterm" ? "Midterm" : "Finals"} (60–100)</p>

                    <p className="mb-2">Separate with comma, space, or tab</p>

                    <p className="mb-1">
                    Example:{" "}
                    <span className="rounded bg-blue-100 px-2 py-1 font-mono">
                        {systemTerm === "midterm" ? "20-0001 85" : "20-0001 90"}
                    </span>
                    </p>

                    <p className="mb-3">
                    Or:{" "}
                    <span className="rounded bg-blue-100 px-2 py-1 font-mono">
                        {systemTerm === "midterm" ? "20-0001,85" : "20-0001,90"}
                    </span>
                    </p>

                <button
                  type="button"
                  onClick={handleDownloadTemplate}
                  className="rounded-lg bg-[#032d63] px-4 py-2 text-sm font-semibold text-white hover:bg-[#02244d]"
                >
                  Download CSV Template
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="p-4">
          {activeTab === "paste" ? (
            <>
              <label className="mb-2 block text-sm font-semibold text-slate-700">
                Paste your grade data:
              </label>

              <textarea
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                placeholder={
  systemTerm === "midterm"
    ? `20-0001 85
20-0002 92
20-0003 78`
    : `20-0001 90
20-0002 88
20-0003 82`
}
                className="w-full min-h-[150px] rounded-xl border p-3 text-sm font-mono placeholder:text-slate-400"
              />
            </>
          ) : (
            <>
              <label className="mb-2 block text-sm font-semibold text-slate-700">
                Upload your CSV file:
              </label>

              <label className="flex h-[150px] w-full cursor-pointer items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 text-sm text-slate-500">
                {selectedFile ? selectedFile.name : "Click to upload CSV"}

                <input
                  type="file"
                  accept=".csv"
                  className="hidden"
                  onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                />
              </label>
            </>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t p-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border px-4 py-2 text-sm"
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={handleUpload}
            disabled={!canUpload}
            className={`rounded-lg px-4 py-2 text-sm text-white ${
              canUpload
                ? "bg-[#032d63] hover:bg-[#02244d]"
                : "cursor-not-allowed bg-slate-400"
            }`}
          >
            Upload
          </button>
        </div>
      </div>
    </div>
  );
};

export default BulkUploadModal;
