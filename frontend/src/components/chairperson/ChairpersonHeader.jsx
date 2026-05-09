import React from "react";
import plvlogo from "../../assets/plvlogo.png";

function ChairpersonHeader({
  chairpersonData,
  departmentCount,
  availableDepartments = [],
  selectedDepartment = "",
  onDepartmentChange,
  onLogout,
}) {
  return (
    <header className="w-full border-b border-slate-200 bg-[#003366] shadow-sm">
      <div className="flex w-full items-center justify-between px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10">
            <img src={plvlogo} alt="PLV Logo" className="h-10 w-10 object-contain" />
          </div>

          <div className="leading-tight">
            <p className="text-sm font-medium text-white/80">Chairperson Portal</p>
            <h1 className="text-xl font-bold text-white">
              Welcome, {chairpersonData?.name || "Chairperson"}
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden rounded-xl bg-white/10 px-4 py-2 md:block">
            <p className="text-xs text-white/70">Department</p>
            {availableDepartments.length > 0 ? (
              <select
                value={selectedDepartment}
                onChange={(event) => onDepartmentChange?.(event.target.value)}
                className="mt-1 min-w-[280px] rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm font-semibold text-white outline-none"
              >
                {availableDepartments.map((department) => (
                  <option key={department} value={department} className="text-slate-900">
                    {department}
                  </option>
                ))}
              </select>
            ) : (
              <p className="text-sm font-semibold text-white">
                {chairpersonData?.department || "Department"}
              </p>
            )}
          </div>

          <div className="hidden rounded-xl bg-white/10 px-4 py-2 text-right md:block">
            <p className="text-xs text-white/70">Faculty Monitored</p>
            <p className="text-sm font-semibold text-white">{departmentCount}</p>
          </div>

          <button
            onClick={onLogout}
            className="rounded-xl border border-yellow-400 bg-transparent px-5 py-2 text-sm font-semibold text-yellow-400 transition hover:bg-yellow-400 hover:text-[#003366]"
          >
            Logout
          </button>
        </div>
      </div>
    </header>
  );
}

export default ChairpersonHeader;
