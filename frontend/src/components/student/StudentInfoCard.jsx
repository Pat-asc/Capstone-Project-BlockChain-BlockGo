import React from "react";

// Safe fallback SVG just in case infoLogo.webp is missing from the assets folder
const infoLogoFallback = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%234b5563'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z' /%3E%3C/svg%3E";

const StudentInfoCard = ({ studentData }) => {
  return (
    <div className="mx-4 mt-5 rounded-xl border border-[#003366] bg-gray-100 p-4 md:mx-6 md:p-6">
      <h3 className="mb-4 text-base font-bold text-[#003366] md:text-lg">
        Student Personal Information
      </h3>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 text-sm">
        <div>
          <p className="text-gray-500">First Name</p>
          <p className="font-semibold">{studentData?.firstName || "--"}</p>
        </div>
        <div>
          <p className="text-gray-500">Last Name</p>
          <p className="font-semibold">{studentData?.lastName || "--"}</p>
        </div>
        <div>
          <p className="text-gray-500">Middle Name</p>
          <p className="font-semibold">{studentData?.middleName || "--"}</p>
        </div>
        <div>
          <p className="text-gray-500">Student ID</p>
          <p className="font-semibold">{studentData?.studentId || "--"}</p>
        </div>
        <div>
          <p className="text-gray-500">Date of Birth</p>
          <p className="font-semibold">{studentData?.dateOfBirth || "--"}</p>
        </div>
        <div>
          <p className="text-gray-500">Sex</p>
          <p className="font-semibold">{studentData?.sex || "--"}</p>
        </div>
        <div>
          <p className="text-gray-500">Phone</p>
          <p className="font-semibold">{studentData?.phone || "--"}</p>
        </div>
        <div className="col-span-2 md:col-span-2">
          <p className="text-gray-500">Email</p>
          <p className="font-semibold break-words">{studentData?.email || "--"}</p>
        </div>

        <div className="col-span-2 md:col-span-3 border-t border-gray-300 pt-4 mt-4"></div>
        
        <p className="personal-info-note text-gray-600 col-span-2 flex items-center gap-2 md:col-span-3">
          <img src={infoLogoFallback} alt="info Logo" className="info-logo h-5 w-5" />
          If your personal information is incorrect or requires an update, kindly visit the Office of the Registrar for assistance.
        </p>
      </div>
    </div>
  );
};

export default StudentInfoCard;