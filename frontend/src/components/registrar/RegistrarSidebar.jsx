import React from "react";

function RegistrarSidebar({ activeTab, setActiveTab }) {
  const menuItems = [
    { id: "dashboard", label: "Dashboard" },
    { id: "encoding", label: "Encoding Period" },
    { id: "studentlist", label: "Student List Import" },
    { id: "monitoring", label: "Monitoring" },
    { id: "finalization", label: "Grade Finalization" },
    { id: "reports", label: "Reports & PDF" },
  ];

  return (
    <aside className="w-full max-w-[260px] rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-4 border-b border-slate-200 pb-3">
        <h2 className="text-lg font-bold text-[#003366]">Registrar Panel</h2>
      </div>

      <nav className="flex flex-col gap-2">
        {menuItems.map((item) => {
          const isActive = activeTab === item.id;
          return (
            <button key={item.id} onClick={() => setActiveTab(item.id)} className={`w-full rounded-xl px-4 py-3 text-left text-sm font-medium transition ${isActive ? "bg-[#003366] text-white shadow-sm" : "text-slate-700 hover:bg-slate-100"}`}>
              {item.label}
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
export default RegistrarSidebar;