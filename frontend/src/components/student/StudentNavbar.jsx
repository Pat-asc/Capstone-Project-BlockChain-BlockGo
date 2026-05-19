import plvlogo from "../../assets/plvlogo.png";

const StudentNavbar = ({ onLogout }) => {
  return (
    <header className="w-full border-b border-slate-200 bg-[#003366] shadow-sm">
      <div className="flex w-full items-center justify-between px-6 py-4">
        {/* Left */}
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10">
            <img
              src={plvlogo}
              alt="PLV Logo"
              className="h-10 w-10 object-contain"
            />
          </div>

          <div className="leading-tight">
            <p className="text-sm text-white/80">Student Portal</p>
            <h1 className="text-xl font-bold text-white">
            Welcome, PLVian!
            </h1>
          </div>
        </div>

        {/* Right */}
        <div className="flex items-center gap-3">
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
};

export default StudentNavbar;