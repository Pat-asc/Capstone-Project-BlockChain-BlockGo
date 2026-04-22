# BlockGo Capstone - Changelog April 22

## 🚀 New Features Added

### 1. **Separate Faculty & Student Websites** ✅
- **Landing Pages**: `/student` & `/faculty` URLs with beautiful gradient themes
- Same login flow → role-based redirect to dedicated portals
- `StudentLanding.jsx` & `FacultyLanding.jsx` with PLV-branded headers

### 2. **PLV Logo Fix** ✅
- Fixed logo loading during OTP verification (reliable import + fallback)
- Logo now displays consistently across all states including loading

### 3. **Real-Time Chat System (Registrar ↔ Students)** ✅
- **SignalR Hub**: `ChatHub.cs` for bidirectional messaging
- **Adaptive Bubbles**: Messenger-style chat UI (flexbox, dynamic sizing)
- **Online Status**: Live indicators for registrar/student/faculty availability  
- **Chat.jsx**: Floating bubble chat with user search & history

### 4. **Advanced Search & Filter** ✅
- **RegistrarSearchController**: `/api/registrar/search?type=student|faculty&query=`
- Full-text search across name/email/student_no/department
- Separate endpoints for accurate student vs faculty filtering

### 5. **Date of Birth Integration** ✅
- **DB Schema**: `studentprofiles.date_of_birth DATE` column
- **Default Password**: DOB format `mm/dd/yyyy` (e.g. "05/15/2005")
- **Login.jsx**: DOB input field shown only for students
- Password auto-hashed & emailed on registration

### 6. **Automated Mock Data & CSV** ✅
```
10 Mock Students Created (full_deploy.sh):
mock.student1@plv.edu.ph | Password: 05/15/2005  
mock.student2@plv.edu.ph | Password: 06/20/2004
... (CS/CE/IT Depts, Enrolled Status)
```
- `./mock_students.csv` auto-generated
- **Auto-Cleanup**: MOCK-* data deleted on `./full_deploy.sh` exit

## 📋 Key Files Created/Updated

```
Backend:
├── Controllers/
│   ├── ChatHub.cs (SignalR Hub)  
│   ├── RegistrarSearchController.cs
│   └── AuthController.cs (DOB logic)
├── Models/
│   ├── ChatMessage.cs
│   ├── SignupRequest.cs (+DOB)
│   └── UserProfileDto.cs (+DOB)
└── RegistrarDbContext.cs (+Chat tables)

Frontend:
├── src/components/
│   ├── StudentLanding.jsx
│   ├── FacultyLanding.jsx
│   └── Chat.jsx (Messenger-style)
├── src/App.js (Router /student /faculty)
└── Login.jsx (DOB field + logo fix)

Deployment:
├── full_deploy.sh (mocks + CSV + cleanup)
└── docker-compose-main.yaml (SignalR port 5001)
```

## 🧪 Testing Commands

```bash
# 1. Full Deploy (auto-mocks)
cd network && ./full_deploy.sh

# 2. Test Login (Mock Student)
Email: mock.student1@plv.edu.ph  
Pass: 05/15/2005 → Lands on /student

# 3. Test Chat: 
http://localhost:5000/chatHub (SignalR)
Open multiple browsers → See online status

# 4. Test Search:
GET /api/registrar/search?type=student&query=cruz

# 5. View CSV:
cat network/mock_students.csv
```

## 🎨 UI/UX Highlights
- **PLV Theme**: Primary blue `#003366` throughout
- **Responsive**: Mobile-friendly chat bubbles  
- **Real-time**: Live typing/online indicators
- **Clean URLs**: `/student` `/faculty` branding

**All features fully integrated and production-ready! 🚀**

