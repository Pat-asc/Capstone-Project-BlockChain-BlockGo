import React from "react";

function ChairpersonSidebar({ activeTab, setActiveTab }) {
  const menuItems = [
    { id: "dashboard", label: "Dashboard" },
    { id: "sectioning", label: "Student Sectioning" },
    { id: "assignment", label: "Academic Assignment" },
    { id: "forReview", label: "For Review" },
    { id: "returned", label: "Returned" },
    { id: "approved", label: "Approved" },
    { id: "forwarded", label: "To Registrar" },
  ];

  return (
    <aside className="w-full max-w-[260px] self-start rounded-2xl border border-slate-200 bg-white p-4 shadow-sm lg:sticky lg:top-6">
      <div className="mb-4 border-b border-slate-200 pb-3">
        <h2 className="text-lg font-bold text-[#003366]">Chairperson Panel</h2>
      </div>

      <nav className="flex flex-col gap-2">
        {menuItems.map((item) => {
          const isActive = activeTab === item.id;

          return (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`w-full rounded-xl px-4 py-3 text-left text-sm font-medium transition ${
                isActive
                  ? "bg-[#003366] text-white shadow-sm"
                  : "text-slate-700 hover:bg-slate-100"
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </nav>
    </aside>
  );
}

export default ChairpersonSidebar;
