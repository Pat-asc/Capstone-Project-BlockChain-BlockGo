import React from "react";
import plvlogo from "../../assets/plvlogo.png";

const stripRolePrefix = (value = "") =>
  String(value)
    .replace(/^(dept\.?\s*admin|department\s*admin|chairperson|prof\.?|mr\.?|ms\.?|mrs\.?|registrar)\s+/i, "")
    .trim();

function ChairpersonHeader({
  chairpersonData,
  departmentCount,
  availableDepartments = [],
  selectedDepartment = "",
  onDepartmentChange,
  onLogout,
}) {
  const displayName =
    stripRolePrefix(chairpersonData?.name) || "Chairperson";

  return (
    <header className="w-full border-b border-slate-200 bg-[#003366] shadow-sm">
      <div className="flex w-full items-center justify-between gap-3 px-4 py-3 sm:px-6 sm:py-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10">
            <img src={plvlogo} alt="PLV Logo" className="h-10 w-10 object-contain" />
          </div>

          <div className="min-w-0 leading-tight">
            <p className="text-sm text-white/80">Chairperson Portal</p>
            <h1 className="truncate text-base font-bold text-white sm:text-xl">
              Welcome, {displayName}
            </h1>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-3">
          <div className="hidden rounded-xl bg-white/10 px-4 py-2 md:block">
            <p className="text-xs text-white/70">Department</p>
            {availableDepartments.length > 0 ? (
              <select
                value={selectedDepartment}
                onChange={(event) => onDepartmentChange?.(event.target.value)}
                className="mt-1 min-w-[220px] rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm font-semibold text-white outline-none"
              >
                {availableDepartments.map((department) => (
                  <option
                    key={department}
                    value={department}
                    className="text-slate-900"
                  >
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
            <p className="text-xs text-white/70">Semester</p>
            <p className="text-sm font-semibold text-white">
              {chairpersonData?.semester || "2nd Semester"}
            </p>
          </div>

          <button
            onClick={onLogout}
            className="rounded-xl border border-yellow-400 bg-transparent px-3 py-2 text-sm font-semibold text-yellow-400 transition hover:bg-yellow-400 hover:text-[#003366] sm:px-5"
          >
            Logout
          </button>
        </div>
      </div>
    </header>
  );
}

export default ChairpersonHeader;
