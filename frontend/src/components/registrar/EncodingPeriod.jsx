import React, { useEffect, useState } from "react";
import { getSystemSetting, updateSystemSetting } from "../../services/api";

function EncodingPeriod({ onResetEncodingSeason }) {
  const [period, setPeriod] = useState({
    startDate: "",
    endDate: "",
    term: "midterm",
  });
  const [statusMessage, setStatusMessage] = useState("");

  useEffect(() => {
    const loadSavedPeriod = async () => {
      try {
        const res = await getSystemSetting("encoding_period");
        if (res.status === "Success" && res.value) {
          const savedPeriod = JSON.parse(res.value);
          setPeriod({
            startDate: savedPeriod?.startDate || "",
            endDate: savedPeriod?.endDate || "",
            term: savedPeriod?.term || "midterm",
          });
        }
      } catch (error) {
        setStatusMessage("No saved encoding period yet.");
      }
    };

    loadSavedPeriod();
  }, []);

  const { startDate, endDate, term } = period;

  const updatePeriod = (field, value) => {
    setPeriod((current) => ({ ...current, [field]: value }));
  };

  const getBannerStatus = () => {
    if (!startDate || !endDate) return "Not Set";

    const today = new Date();
    const start = new Date(startDate);
    const end = new Date(endDate);

    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);
    today.setHours(0, 0, 0, 0);

    if (today < start) return "Closed (Not Started Yet)";
    if (today > end) return "Closed";
    
    const diffTime = end - today;
    const daysLeft = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (daysLeft <= 3) return "Urgent";
    return "Open";
  };

  const handleSave = async () => {
    const encodingData = {
      ...period,
    };

    try {
      await updateSystemSetting("encoding_period", JSON.stringify(encodingData));
      setStatusMessage("Encoding period saved successfully.");
    } catch (error) {
      setStatusMessage(error.message || "Failed to save encoding period.");
    }
  };

  const handleResetSeason = () => {
    const shouldReset = window.confirm(
      "Reset this encoding season? This will clear faculty section assignments, saved grades, and chairperson review statuses."
    );

    if (!shouldReset) return;

    onResetEncodingSeason?.();
    alert("Encoding season has been reset. Faculty section cards are now cleared.");
  };

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h3 className="text-xl font-bold text-[#003366]">
              Encoding Period Control
            </h3>
            <p className="mt-1 text-sm text-slate-500">
              Set the grade encoding schedule for faculty members.
            </p>
          </div>

          <span
            className={`inline-flex w-fit rounded-full px-4 py-2 text-sm font-semibold ${
              getBannerStatus() === "Open"
                ? "bg-green-100 text-green-700"
                : getBannerStatus() === "Urgent"
                ? "bg-yellow-100 text-yellow-700"
                : "bg-red-100 text-red-700"
            }`}
          >
            {getBannerStatus()}
          </span>
        </div>

        {statusMessage && (
          <p className="mt-4 rounded-xl bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-600">
            {statusMessage}
          </p>
        )}

        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">
              Encoding Term
            </label>
            <select
              value={term}
              onChange={(e) => updatePeriod("term", e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-[#003366]"
            >
              <option value="midterm">Midterms</option>
              <option value="finals">Finals</option>
            </select>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">
              Start Date
            </label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => updatePeriod("startDate", e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-[#003366]"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">
              End Date
            </label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => updatePeriod("endDate", e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-[#003366]"
            />
          </div>
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          <button
            onClick={handleSave}
            className="rounded-xl bg-[#003366] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#00264d]"
          >
            Save Schedule
          </button>

          <button
            onClick={handleResetSeason}
            className="rounded-xl border border-red-200 bg-red-50 px-5 py-3 text-sm font-semibold text-red-700 transition hover:bg-red-100"
          >
            Reset Encoding Season
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="text-lg font-bold text-[#003366]">Current Schedule</h3>

        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-4">
          <div className="rounded-xl bg-slate-50 p-4">
            <p className="text-sm text-slate-500">Encoding Term</p>
            <p className="mt-1 font-semibold text-slate-800">
              {term === "midterm" ? "Midterms" : "Finals"}
            </p>
          </div>

          <div className="rounded-xl bg-slate-50 p-4">
            <p className="text-sm text-slate-500">Start Date</p>
            <p className="mt-1 font-semibold text-slate-800">{startDate}</p>
          </div>

          <div className="rounded-xl bg-slate-50 p-4">
            <p className="text-sm text-slate-500">End Date</p>
            <p className="mt-1 font-semibold text-slate-800">{endDate}</p>
          </div>

          <div className="rounded-xl bg-slate-50 p-4">
            <p className="text-sm text-slate-500">Faculty Banner Status</p>
            <p className="mt-1 font-semibold text-slate-800">
              {getBannerStatus()}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default EncodingPeriod;
