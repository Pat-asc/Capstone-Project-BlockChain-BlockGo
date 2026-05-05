import React, { useMemo, useState } from "react";
import { getDecryptedIpfsUrl } from "../../services/api";
import Modal from "../../services/Modal";

const computeGradeStatus = () => "Passed";
const getReviewStatusClasses = () => "bg-blue-50 text-blue-800";
const getReviewStatusLabel = (status) => status || "Pending";
const getGradeEquivalent = (grade) => grade;

function SectionReviewPanel({
  selectedSection,
  activeTerm,
  onSendBack,
  onApprove,
  onSubmitToRegistrar,
  onViewIpfs
}) {
  const [draftNotes, setDraftNotes] = useState({});
  const note = selectedSection ? draftNotes[selectedSection.reviewKey] ?? selectedSection.reviewNote ?? "" : "";

  const [ipfsModalOpen, setIpfsModalOpen] = useState(false);
  const [ipfsCid, setIpfsCid] = useState("");
  const [vaultPassword, setVaultPassword] = useState("");
  const [showVaultPassword, setShowVaultPassword] = useState(false);

  const rows = useMemo(() => {
    if (!selectedSection) return [];
    return selectedSection.students.map((student) => {
      const record = selectedSection.grades[student.studentId] || {};
      return {
        id: student.studentId || student.id,
        name: `${student.lastName || ""}, ${student.firstName || ""}`.replace(/^,\s*/, ""),
        midterm: record.midterm || "-",
        finals: record.finals || "-",
        finalAverage: record.finalAverage || "-",
        gradeEquivalent: getGradeEquivalent(record.finalAverage || "-"),
        standing: record.standing || "active",
        flagged: !!record.flagged,
        status: computeGradeStatus(),
      };
    });
  }, [selectedSection, activeTerm]);

  const handleViewIpfs = (cid) => {
    if (onViewIpfs) {
        onViewIpfs(cid);
    } else {
        setIpfsCid(cid);
        setVaultPassword("");
        setShowVaultPassword(false);
        setIpfsModalOpen(true);
    }
  };

  const submitIpfsPassword = () => {
    if (vaultPassword) {
        const url = getDecryptedIpfsUrl(ipfsCid, vaultPassword);
        window.open(url, "_blank");
        setIpfsModalOpen(false);
    }
  };

  if (!selectedSection) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center shadow-sm">
        <h3 className="text-xl font-semibold text-[#003366]">Section Review Panel</h3>
        <p className="mt-2 text-sm text-slate-500">Select a faculty section to review grades.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h3 className="text-xl font-bold text-[#003366]">Section Review Details</h3>
            <p className="mt-1 text-sm text-slate-500">{selectedSection.facultyName} • {selectedSection.sectionName}</p>
          </div>
          <div className="flex flex-col items-end gap-3">
            <span className={`inline-flex w-fit rounded-full px-4 py-2 text-sm font-semibold ${getReviewStatusClasses()}`}>{getReviewStatusLabel(selectedSection.reviewStatus)}</span>
            {selectedSection.ipfsCid ? (
              <button 
                  onClick={() => handleViewIpfs(selectedSection.ipfsCid)} 
                  className="inline-flex items-center gap-2 rounded-lg bg-blue-50 px-4 py-2 text-sm font-bold text-blue-700 transition hover:bg-blue-100 shadow-sm"
              >
                   View Attached Source File
              </button>
            ) : (
              <span className="inline-flex items-center gap-2 rounded-lg bg-slate-50 px-4 py-2 text-sm font-medium text-slate-400 shadow-sm">
                  No File Attached
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="text-lg font-bold text-[#003366]">Submitted Grades</h3>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full">
            <thead>
              <tr className="bg-[#003366] text-white">
                <th className="px-4 py-3 text-left text-sm">Student ID</th>
                <th className="px-4 py-3 text-left text-sm">Student Name</th>
                <th className="px-4 py-3 text-left text-sm">Midterm</th>
                <th className="px-4 py-3 text-left text-sm">Finals</th>
                <th className="px-4 py-3 text-left text-sm">Final Grade</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b bg-white">
                  <td className="px-4 py-3">{row.id}</td>
                  <td className="px-4 py-3 font-medium text-slate-800">
                    {row.name}
                    {row.flagged && (
                      <span className="ml-2 inline-block rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-700">
                        Flagged
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">{row.midterm}</td>
                  <td className="px-4 py-3">{row.finals}</td>
                  <td className="px-4 py-3 font-semibold text-slate-800">{row.finalAverage}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="text-lg font-bold text-[#003366]">Chairperson Decision</h3>
        <div className="mt-4">
          <label className="mb-2 block text-sm font-medium text-slate-700">Review Note</label>
          <textarea
            value={note}
            onChange={(event) => setDraftNotes((prev) => ({ ...prev, [selectedSection.reviewKey]: event.target.value }))}
            placeholder="Enter discrepancy or approval remark here..."
            className="min-h-[120px] w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-[#003366]"
          />
        </div>
        <div className="mt-6 flex flex-col gap-3 md:flex-row">
          <button onClick={() => onSendBack(note)} className="rounded-xl bg-red-500 px-5 py-3 text-sm font-semibold text-white transition hover:bg-red-600">
            Send Back to Faculty
          </button>
          <button onClick={() => onApprove(note)} className="rounded-xl bg-emerald-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700">
            Approve Section
          </button>
          <button onClick={() => onSubmitToRegistrar(note)} className="rounded-xl bg-[#003366] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#00264d]">
            Forward to Registrar
          </button>
        </div>
      </div>

      {/* Internal IPFS Modal for Fallback */}
      <Modal isOpen={ipfsModalOpen} onClose={() => setIpfsModalOpen(false)} title="IPFS Vault Decryption">
        <div className="flex flex-col gap-4">
          <p className="text-sm text-slate-600">
            This academic record is encrypted and distributed across the PLV IPFS Network. Enter the Vault Password to view the decrypted content.
          </p>
          <div className="relative">
            <input type={showVaultPassword ? "text" : "password"} value={vaultPassword} onChange={(e) => setVaultPassword(e.target.value)} className="w-full rounded-xl border border-slate-300 px-4 py-3 pr-10 text-sm outline-none focus:border-[#003366]" placeholder="Enter Vault Password" onKeyDown={(e) => e.key === 'Enter' && submitIpfsPassword()} autoFocus />
            <button type="button" onClick={() => setShowVaultPassword(!showVaultPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-[#003366]" title={showVaultPassword ? "Hide Password" : "Show Password"}>
              {showVaultPassword ? (
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" /></svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
              )}
            </button>
          </div>
          <div className="flex justify-end gap-3 mt-4">
            <button onClick={() => setIpfsModalOpen(false)} className="rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-sm font-bold text-slate-700 transition hover:bg-slate-50">Cancel</button>
            <button onClick={submitIpfsPassword} className="rounded-xl bg-[#003366] px-5 py-2.5 text-sm font-bold text-white transition hover:bg-[#00264d]">Decrypt & View</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
export default SectionReviewPanel;