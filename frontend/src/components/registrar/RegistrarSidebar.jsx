import React from "react";

function RegistrarSidebar({ activeTab, setActiveTab, chatUnreadCount = 0, latestChatNotice = null, onOpenChat }) {
  const menuItems = [
  { id: "dashboard", label: "Dashboard" },
  { id: "encoding", label: "Encoding Period" },
  { id: "sectioning", label: "Student Sectioning" },
  { id: "sectionsCreated", label: "Sections Created" },
  { id: "monitoring", label: "Monitoring" },
  { id: "finalization", label: "Grade Finalization" },
  { id: "reports", label: "Reports & PDF" },
];

  return (
    <aside className="w-full max-w-[260px] self-start rounded-2xl border border-slate-200 bg-white p-4 shadow-sm lg:sticky lg:top-6">
      <div className="mb-4 border-b border-slate-200 pb-3">
        <h2 className="text-lg font-bold text-[#003366]">Registrar Panel</h2>

        {onOpenChat && (
          <button
            type="button"
            onClick={onOpenChat}
            className="mt-3 w-full rounded-xl border border-blue-100 bg-blue-50 px-3 py-3 text-left transition hover:bg-blue-100"
          >
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-bold text-[#003366]">Chat Notifications</span>
              {chatUnreadCount > 0 && (
                <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-red-500 px-2 text-xs font-bold text-white">
                  {chatUnreadCount > 9 ? "9+" : chatUnreadCount}
                </span>
              )}
            </div>
            <p className="mt-1 truncate text-xs text-slate-500">
              {latestChatNotice
                ? `${latestChatNotice.from}: ${latestChatNotice.message}`
                : "No new chat messages"}
            </p>
          </button>
        )}
      </div>

      <nav className="flex flex-col gap-2">
        {menuItems.map((item) => {
          const isActive = activeTab === item.id;

          return (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`w-full rounded-xl border-b-2 px-4 py-3 text-left text-sm font-medium transition ${
                isActive
                  ? "border-yellow-400 bg-[#003366] text-white shadow-sm"
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

export default RegistrarSidebar;
