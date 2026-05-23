import React, { useState, useEffect } from "react";
import { fetchSystemLogs } from "../../services/api";

function SystemLogs() {
  const [logs, setLogs] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [dateFilter, setDateFilter] = useState("");

  useEffect(() => {
    const fetchLogs = async () => {
      try {
        const data = await fetchSystemLogs();
        if (data.status === "Success") {
          setLogs(data.data || []);
        }
      } catch (e) {
        console.error("Failed to fetch system logs:", e);
      }
      setIsLoading(false);
    };
    fetchLogs();
  }, []);

  const filteredLogs = logs.filter((log) => {
    const matchesSearch = 
      (log.recordId || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
      (log.reason || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
      (log.approvedBy || "").toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesDate = dateFilter 
      ? log.timestamp && new Date(log.timestamp).toISOString().startsWith(dateFilter)
      : true;
    
    return matchesSearch && matchesDate;
  });

  const handleExportPDF = () => {
    try {
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF();

      // Add Header
      doc.setTextColor(0, 51, 102); // #003366
      doc.setFontSize(20);
      doc.setFont("helvetica", "bold");
      doc.text("PLV SYSTEM ACTIVITY REPORT", 14, 22);
      
      doc.setFontSize(10);
      doc.setTextColor(100);
      doc.setFont("helvetica", "normal");
      doc.text("Pamantasan ng Lungsod ng Valenzuela", 14, 28);
      doc.text(`Generated on: ${new Date().toLocaleString()}`, 14, 33);
      doc.text(`Total Records: ${filteredLogs.length}`, 14, 38);

      // Add a line separator
      doc.setDrawColor(0, 51, 102);
      doc.setLineWidth(0.5);
      doc.line(14, 42, 196, 42);

      // Table Data
      const tableColumn = ["Timestamp", "User", "Action/Reason", "Record ID", "Change"];
      const tableRows = filteredLogs.map(log => [
        new Date(log.timestamp).toLocaleString(),
        log.approvedBy || "N/A",
        log.reason || "N/A",
        log.recordId || "N/A",
        log.oldGrade ? `${log.oldGrade} → ${log.newGrade}` : `Created: ${log.newGrade}`
      ]);

      // Generate Table
      doc.autoTable({
        head: [tableColumn],
        body: tableRows,
        startY: 48,
        theme: 'striped',
        headStyles: { fillColor: [0, 51, 102], fontSize: 9 },
        bodyStyles: { fontSize: 8 },
        alternateRowStyles: { fillColor: [245, 247, 250] },
      });

      // Footer
      const pageCount = doc.internal.getNumberOfPages();
      for(let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFontSize(8);
        doc.setTextColor(150);
        doc.text(`Page ${i} of ${pageCount} - Secured via PLV Ledger`, 105, 285, { align: 'center' });
      }

      doc.save(`System_Activity_Log_${new Date().toISOString().split('T')[0]}.pdf`);
    } catch (error) {
      console.error("PDF Generation failed:", error);
      alert("Failed to generate PDF. Please try again.");
    }
  };

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-[#003366]">System Activity Logs</h2>
          <p className="text-sm text-slate-500">Monitor all grade modifications and administrative actions.</p>
        </div>
        <button 
          onClick={handleExportPDF}
          className="rounded-lg bg-[#003366] px-4 py-2 text-sm font-bold text-white transition hover:bg-[#00264d]"
        >
          Export Log as PDF
        </button>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <label className="block text-xs font-bold uppercase text-slate-400">Search Records/Users</label>
          <input 
            type="text" 
            placeholder="Search student ID, professor, or action..."
            className="mt-1 w-full rounded-lg border border-slate-200 p-2 text-sm outline-none focus:border-[#003366]"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-xs font-bold uppercase text-slate-400">Filter by Date</label>
          <input 
            type="date" 
            className="mt-1 w-full rounded-lg border border-slate-200 p-2 text-sm outline-none focus:border-[#003366]"
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
          />
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs font-bold uppercase text-slate-500">
            <tr>
              <th className="px-6 py-4">Timestamp</th>
              <th className="px-6 py-4">User</th>
              <th className="px-6 py-4">Action/Reason</th>
              <th className="px-6 py-4">Record ID</th>
              <th className="px-6 py-4">Change</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading ? (
              <tr><td colSpan="5" className="px-6 py-10 text-center text-slate-400">Loading system logs...</td></tr>
            ) : filteredLogs.length === 0 ? (
              <tr><td colSpan="5" className="px-6 py-10 text-center text-slate-400">No activity logs found.</td></tr>
            ) : (
              filteredLogs.map((log) => (
                <tr key={log.id} className="hover:bg-slate-50">
                  <td className="px-6 py-4 font-mono text-xs">{new Date(log.timestamp).toLocaleString()}</td>
                  <td className="px-6 py-4 font-semibold">{log.approvedBy}</td>
                  <td className="px-6 py-4">{log.reason}</td>
                  <td className="px-6 py-4 text-xs font-mono">{log.recordId}</td>
                  <td className="px-6 py-4">
                    {log.oldGrade ? (
                      <span className="flex items-center gap-2">
                        <span className="text-slate-400 line-through">{log.oldGrade}</span>
                        <span className="text-emerald-600 font-bold">→ {log.newGrade}</span>
                      </span>
                    ) : (
                      <span className="text-blue-600 font-bold">Created: {log.newGrade}</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default SystemLogs;
