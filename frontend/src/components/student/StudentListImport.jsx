import React, { useEffect, useMemo, useRef, useState } from "react";
import { uploadToIpfs } from "../../services/api";
const programs = [
  "Bachelor of Science in Accountancy",
  "Bachelor of Science in Business Administration major in Financial Management",
  "Bachelor of Science in Business Administration major in Marketing Management",
  "Bachelor of Science in Business Administration major in Human Resource Management",
  "Bachelor of Science in Entrepreneurship",
  "Bachelor of Science in Civil Engineering",
  "Bachelor of Science in Electrical Engineering",
  "Bachelor of Science in Computer Engineering",
  "Bachelor of Science in Information Technology",
  "Bachelor of Early Childhood Education",
  "Bachelor of Secondary Education major in English",
  "Bachelor of Secondary Education major in Filipino",
  "Bachelor of Secondary Education major in Mathematics",
  "Bachelor of Secondary Education major in Science",
  "Bachelor of Secondary Education major in Social Studies",
  "Bachelor of Physical Education",
  "Bachelor of Arts in Communication",
  "Bachelor of Arts in Psychology",
  "Bachelor of Science in Social Work",
  "Bachelor of Science in Public Administration",
  "Master of Arts in Education",
  "Master in Public Administration"
];
const buildChairpersonName = (program) => `${program} Chairperson`;
const parseStudentIdSpreadsheet = (text) => [];
const buildStudentCsvContent = () => "";

function StudentListImport() {
  const [selectedProgram, setSelectedProgram] = useState("");
  const [selectedBatchYear, setSelectedBatchYear] = useState("");
  const [selectedFile, setSelectedFile] = useState(null);
  const [isYearPickerOpen, setIsYearPickerOpen] = useState(false);
  const [yearPickerAnchor, setYearPickerAnchor] = useState(() => new Date().getFullYear() - 5);
  const yearPickerRef = useRef(null);
  const [isUploading, setIsUploading] = useState(false);

  const [submissionBatches, setSubmissionBatches] = useState(() => {
    try { return JSON.parse(localStorage.getItem("STUDENT_BATCHES_KEY")) || []; } catch(e) { return []; }
  });
  const [submissionLogs, setSubmissionLogs] = useState(() => {
    try { return JSON.parse(localStorage.getItem("STUDENT_SUBMISSION_LOGS_KEY")) || []; } catch(e) { return []; }
  });

  useEffect(() => {
    if (!isYearPickerOpen) return;
    const handleOutsideClick = (event) => {
      if (yearPickerRef.current?.contains(event.target)) return;
      setIsYearPickerOpen(false);
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [isYearPickerOpen]);

  const yearOptions = useMemo(() => Array.from({ length: 12 }, (_, index) => String(yearPickerAnchor + index)), [yearPickerAnchor]);

  const openYearPicker = () => {
    const resolvedYear = Number(selectedBatchYear) || new Date().getFullYear();
    setYearPickerAnchor(resolvedYear - 5);
    setIsYearPickerOpen(true);
  };

  const handleYearInputChange = (event) => {
    const numericValue = event.target.value.replace(/\D/g, "").slice(0, 4);
    setSelectedBatchYear(numericValue);
    if (numericValue.length === 4) setYearPickerAnchor(Number(numericValue) - 5);
  };

  const handleYearSelect = (year) => {
    setSelectedBatchYear(year);
    setIsYearPickerOpen(false);
  };

  const handleDownloadTemplate = () => {
    if (!selectedProgram || !selectedBatchYear) {
      alert("Please complete the department and batch year first.");
      return;
    }
    const csvContent = "student_no,full_name,email,date_of_birth,department,section,grade,course,semester,school_year\nMOCK-tudent1,Juan Dela Cruz,mock.student1@plv.edu.ph,2005-05-15,Bachelor of Science in Computer Science,3-1,95,Bachelor of Science in Computer Science,2nd Semester,2024\n";
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `${selectedProgram}-${selectedBatchYear}-student-list.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleImport = () => {
    if (!selectedProgram || !selectedBatchYear) { alert("Please complete the department and batch year first."); return; }
    if (!/^\d{4}$/.test(selectedBatchYear)) { alert("Batch year must be a 4-digit year."); return; }
    if (!selectedFile) { alert("Please choose the Excel CSV file first."); return; }
    if (!selectedFile.name.toLowerCase().endsWith(".csv")) { alert("Please upload the Excel CSV template in .csv format."); return; }

    setIsUploading(true);
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
      const text = event.target?.result;
      if (!text) { alert("Unable to read file."); return; }

      const ipfsRes = await uploadToIpfs(selectedFile);
      const cid = ipfsRes.cid;

      // Parse the CSV to extract the actual students
      const lines = text.split(/\r?\n/).filter(line => line.trim().length > 0);
      const parsedStudents = lines.slice(1).map(line => {
        const cols = line.split(',');
        return { studentId: cols[0], lastName: cols[1], firstName: "", mi: "", sex: "N/A" };
      });
      const submissionKey = [selectedProgram, selectedBatchYear].join("|");
      const submittedAt = new Date().toISOString();

      const nextBatch = {
        id: Date.now(),
        key: submissionKey,
        program: selectedProgram,
        batchYear: selectedBatchYear,
        submittedTo: buildChairpersonName(selectedProgram),
        fileName: selectedFile.name,
        submittedAt,
        status: "Forwarded",
        receivedCsvContent: text,
        students: parsedStudents,
        ipfsCid: cid
      };

      const updatedBatches = [...submissionBatches.filter((batch) => batch.key !== submissionKey), nextBatch];
      const updatedLogs = [{
          id: Date.now(),
          program: selectedProgram,
          batchYear: selectedBatchYear,
          submittedTo: buildChairpersonName(selectedProgram),
          fileName: selectedFile.name,
          totalStudents: parsedStudents.length,
          submittedAt,
          status: "Forwarded",
          ipfsCid: cid
      }, ...submissionLogs];

      setSubmissionBatches(updatedBatches);
      setSubmissionLogs(updatedLogs);
      localStorage.setItem("STUDENT_BATCHES_KEY", JSON.stringify(updatedBatches));
      localStorage.setItem("STUDENT_SUBMISSION_LOGS_KEY", JSON.stringify(updatedLogs));

      setSelectedFile(null);
      alert("Student list forwarded to the chairperson successfully.");
      } catch (err) {
        alert("Upload failed: " + err.message);
      } finally {
        setIsUploading(false);
      }
    };
    reader.readAsText(selectedFile);
  };

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-5">
          <h3 className="text-2xl font-bold text-[#003366]">Student List Import</h3>
          <p className="mt-1 text-sm text-slate-500">Upload one Excel CSV file per department with student details to forward to the assigned chairperson for sectioning.</p>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">Department</label>
            <select value={selectedProgram} onChange={(event) => setSelectedProgram(event.target.value)} className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none focus:border-[#003366]">
              <option value="">Choose department</option>
              {programs.map((program) => <option key={program} value={program}>{program}</option>)}
            </select>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">Batch Year</label>
            <div ref={yearPickerRef} className="relative">
              <input type="text" inputMode="numeric" value={selectedBatchYear} onFocus={openYearPicker} onClick={openYearPicker} onChange={handleYearInputChange} className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none focus:border-[#003366]" placeholder="Select year" />
              {isYearPickerOpen ? (
                <div className="absolute left-0 top-[calc(100%+12px)] z-20 w-full min-w-[320px] rounded-3xl border border-slate-200 bg-white shadow-xl">
                  <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
                    <button type="button" onClick={() => setYearPickerAnchor((current) => current - 12)} className="text-2xl font-light text-slate-500 transition hover:text-[#003366]">‹</button>
                    <p className="text-lg font-semibold text-slate-700">{yearPickerAnchor + 5}</p>
                    <button type="button" onClick={() => setYearPickerAnchor((current) => current + 12)} className="text-2xl font-light text-slate-500 transition hover:text-[#003366]">›</button>
                  </div>
                  <div className="grid grid-cols-3 gap-3 p-5">
                    {yearOptions.map((year) => (
                        <button key={year} type="button" onClick={() => handleYearSelect(year)} className={`rounded-2xl px-4 py-5 text-lg transition ${selectedBatchYear === year ? "bg-rose-50 text-rose-500" : "text-slate-700 hover:bg-slate-100"}`}>{year}</button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <div className="mt-6 rounded-3xl border-2 border-dashed border-slate-300 bg-slate-50 p-6">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_auto_auto] lg:items-end">
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">Upload Excel CSV File</label>
              <input type="file" accept=".csv" onChange={(e) => setSelectedFile(e.target.files?.[0] || null)} className="block w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm" />
              <p className="mt-2 text-sm text-slate-500">{selectedFile ? `Selected file: ${selectedFile.name}` : "Template format: student_no, full_name, email, date_of_birth, department..."}</p>
            </div>
            <button onClick={handleDownloadTemplate} className="rounded-2xl border border-[#003366] px-5 py-3 text-sm font-semibold text-[#003366] transition hover:bg-[#003366] hover:text-white">Download Template</button>
            <button onClick={handleImport} disabled={isUploading} className="rounded-2xl bg-[#003366] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[#00264d] disabled:opacity-50">
              {isUploading ? "Uploading to IPFS..." : "Forward to Chairperson"}
            </button>
          </div>
        </div>
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-4">
            <h3 className="text-xl font-bold text-[#003366]">Submission Logs</h3>
            <p className="mt-1 text-sm text-slate-500">Track which department files were already forwarded.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr className="bg-[#003366] text-white">
                  <th className="px-4 py-3 text-left text-sm">Department</th>
                  <th className="px-4 py-3 text-left text-sm">Batch Year</th>
                  <th className="px-4 py-3 text-left text-sm">File</th>
                  <th className="px-4 py-3 text-left text-sm">Students</th>
                  <th className="px-4 py-3 text-left text-sm">Forwarded To</th>
                  <th className="px-4 py-3 text-left text-sm">Forwarded At</th>
                  <th className="px-4 py-3 text-left text-sm">Status</th>
                </tr>
              </thead>
              <tbody>
                {submissionLogs.length > 0 ? (
                  submissionLogs.map((log) => (
                    <tr key={log.id} className="border-b bg-white">
                      <td className="px-4 py-3">{log.program}</td>
                      <td className="px-4 py-3">{log.batchYear}</td>
                      <td className="px-4 py-3">
                        {log.ipfsCid ? (
                          <a href={`http://127.0.0.1:5001/ipfs/bafybeiddnr2jz65byk67sjt6jsu6g7tueddr7odhzzpzli3rgudlbnc6iq/#/ipfs/${log.ipfsCid}`} target="_blank" rel="noreferrer" className="text-blue-600 font-bold hover:underline"> View Content in IPFS</a>
                        ) : log.fileName}
                      </td>
                      <td className="px-4 py-3">{log.totalStudents}</td>
                      <td className="px-4 py-3">{log.submittedTo}</td>
                      <td className="px-4 py-3">{new Date(log.submittedAt).toLocaleString("en-US")}</td>
                      <td className="px-4 py-3"><span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">{log.status}</span></td>
                    </tr>
                  ))
                ) : (
                  <tr><td colSpan="7" className="py-8 text-center text-slate-500">No submission logs yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
      </div>
    </div>
  );
}
export default StudentListImport;