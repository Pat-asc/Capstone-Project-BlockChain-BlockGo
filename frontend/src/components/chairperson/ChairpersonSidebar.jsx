import React from "react";

function ChairpersonSidebar({ activeTab, setActiveTab }) {
  const menuItems = [
    { id: "dashboard", label: "Encoding Monitoring" },
    { id: "sectioning", label: "Department Sections" },
    { id: "assignment", label: "Academic Assignment" },
    { id: "forReview", label: "For Review" },
    { id: "returned", label: "Returned" },
    { id: "forwarded", label: "Forwarded" },
  ];

  return (
    <aside className="w-full max-w-none self-start rounded-2xl border border-slate-200 bg-white p-4 shadow-sm lg:sticky lg:top-6 lg:max-w-[260px]">
      <div className="mb-4 border-b border-slate-200 pb-3">
        <h2 className="text-lg font-bold text-[#003366]">Chairperson Panel</h2>
      </div>

      <nav className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
        {menuItems.map((item) => {
          const isActive = activeTab === item.id;

          return (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`min-w-[160px] rounded-xl border-b-2 px-4 py-3 text-left text-sm font-medium transition lg:w-full lg:min-w-0 ${
                isActive
                  ? "border-yellow-400 bg-[#003366] text-yellow-400 shadow-sm"
                  : "border-transparent text-slate-700 hover:bg-slate-100"
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
