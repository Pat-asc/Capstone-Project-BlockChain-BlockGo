import React, { useState, useEffect } from "react";

const infoLogoFallback = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%234b5563'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z' /%3E%3C/svg%3E";

const StudentInfoCard = ({ studentData, onProfileUpdated }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [phone, setPhone] = useState("");
  const [sex, setSex] = useState("");
  const [middleName, setMiddleName] = useState("");
  const [status, setStatus] = useState({ type: "", message: "" });
  const [localData, setLocalData] = useState(studentData);
  const [isLoading, setIsLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);

  useEffect(() => {
    if (studentData) {
      setLocalData(studentData);
      const fetchExtendedData = async () => {
        setIsLoading(true);
        try {
          const token = localStorage.getItem("token");
          const response = await fetch(`/api/Student/profile`, {
            headers: { "Authorization": `Bearer ${token}` },
            cache: "no-store"
          });
          
          if (response.ok) {
            const extData = await response.json();
            setPhone(extData.phone || "");
            setSex(extData.sex || "");
            setMiddleName(extData.middleName || "");
            
            setLocalData(prev => ({ 
              ...prev, 
              phone: extData.phone || "", 
              sex: extData.sex || "", 
              middleName: extData.middleName || "" 
            }));
            setFetchError(false);
          } else {
            console.warn("GET endpoint missing. Status:", response.status);
            setFetchError(true);
          }
        } catch (error) {
          console.error("Failed to fetch extended profile data:", error);
          setFetchError(true);
        } finally {
          setIsLoading(false);
        }
      };
      
      fetchExtendedData();
    }
  }, [studentData]);

  const handleUpdateProfile = async (e) => {
    e.preventDefault();
    setStatus({ type: "loading", message: "Updating profile..." });

    try {
      const token = localStorage.getItem("token");

      const response = await fetch(`/api/Student/profile`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({ phone, sex, middleName })
      });

      if (response.ok) {
        setStatus({ type: "success", message: "Profile updated successfully!" });
        setIsEditing(false);
        setLocalData(prev => ({ ...prev, phone, sex, middleName }));
        if (onProfileUpdated) onProfileUpdated();
        setTimeout(() => setStatus({ type: "", message: "" }), 3000);
      } else {
        const errorData = await response.json();
        setStatus({ type: "error", message: errorData.message || "Failed to update profile." });
      }
    } catch (error) {
      console.error("Profile update error:", error);
      setStatus({ type: "error", message: "A network error occurred. Please try again." });
    }
  };

  return (
    <div className="mx-4 mt-5 rounded-xl border border-[#003366] bg-gray-100 p-4 md:mx-6 md:p-6">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-base font-bold text-[#003366] md:text-lg">
          Student Personal Information
        </h3>
        <button 
          onClick={() => setIsEditing(!isEditing)}
          className="text-sm font-semibold text-[#003366] hover:underline"
        >
          {isEditing ? "Cancel" : "Edit Profile"}
        </button>
      </div>

      {status.message && (
        <div className={`mb-4 p-2 rounded text-sm ${status.type === 'success' ? 'bg-green-100 text-green-700' : status.type === 'error' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>
          {status.message}
        </div>
      )}

      <form onSubmit={handleUpdateProfile} className="grid grid-cols-2 gap-4 md:grid-cols-3 text-sm">
        <div>
          <p className="text-gray-500">First Name</p>
          <p className="font-semibold">{localData?.firstName || "--"}</p>
        </div>
        <div>
          <p className="text-gray-500">Last Name</p>
          <p className="font-semibold">{localData?.lastName || "--"}</p>
        </div>
        <div>
          <p className="text-gray-500">Middle Name</p>
          {isEditing ? (
            <input type="text" value={middleName} onChange={(e) => setMiddleName(e.target.value)} className="mt-1 w-full rounded border-gray-300 p-1 border shadow-sm focus:border-[#003366] focus:outline-none" placeholder="Optional" />
          ) : (
            <p className="font-semibold">{isLoading ? "Loading..." : (middleName || (fetchError ? "⚠️ Backend Sync Error" : (localData?.middleName || "--")))}</p>
          )}
        </div>
        <div>
          <p className="text-gray-500">Student ID</p>
          <p className="font-semibold">{localData?.studentId || "--"}</p>
        </div>
        <div>
          <p className="text-gray-500">Date of Birth</p>
          <p className="font-semibold">{localData?.dateOfBirth || "--"}</p>
        </div>
        <div>
          <p className="text-gray-500">Sex</p>
          {isEditing ? (
            <select value={sex} onChange={(e) => setSex(e.target.value)} className="mt-1 w-full rounded border-gray-300 p-1 border shadow-sm focus:border-[#003366] focus:outline-none">
              <option value="">Not Specified</option>
              <option value="Male">Male</option>
              <option value="Female">Female</option>
            </select>
          ) : (
            <p className="font-semibold">{isLoading ? "Loading..." : (sex || (fetchError ? "⚠️ Backend Sync Error" : (localData?.sex || "--")))}</p>
          )}
        </div>
        <div>
          <p className="text-gray-500">Phone</p>
          {isEditing ? (
            <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className="mt-1 w-full rounded border-gray-300 p-1 border shadow-sm focus:border-[#003366] focus:outline-none" placeholder="+63 9XX XXX XXXX" />
          ) : (
            <p className="font-semibold">{isLoading ? "Loading..." : (phone || (fetchError ? "⚠️ Backend Sync Error" : (localData?.phone || "--")))}</p>
          )}
        </div>
        <div className="col-span-2 md:col-span-2">
          <p className="text-gray-500">Email</p>
          <p className="font-semibold break-words">{localData?.email || "--"}</p>
        </div>
        <div>
          <p className="text-gray-500">Department</p>
          <p className="font-semibold">{localData?.department || "Unassigned"}</p>
        </div>
        <div>
          <p className="text-gray-500">Section</p>
          <p className="font-semibold">{localData?.section || "Unassigned"}</p>
        </div>

        {isEditing && (
          <div className="col-span-2 md:col-span-3 flex justify-end mt-2">
            <button type="submit" disabled={status.type === 'loading'} className="bg-[#003366] text-white px-4 py-2 rounded shadow hover:bg-[#002244] disabled:opacity-50 transition-colors">
              Save Changes
            </button>
          </div>
        )}

        <div className="col-span-2 md:col-span-3 border-t border-gray-300 pt-4 mt-4"></div>
        
        <p className="personal-info-note text-gray-600 col-span-2 flex items-center gap-2 md:col-span-3">
          <img src={infoLogoFallback} alt="info Logo" className="info-logo h-5 w-5" />
          To request changes to restricted physical documents (First/Last Name, Department, Date of Birth), please use the embedded Chat to contact the Registrar directly.
        </p>
      </form>
    </div>
  );
};

export default StudentInfoCard;