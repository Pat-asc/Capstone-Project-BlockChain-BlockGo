# TODO - Chat Features

## Phase 1 (Frontend only)
- [x] Update `frontend/src/components/shared/Chat.jsx` (start)
  - [ ] #1 Hover effect on user name with role-based colors (student/faculty/department admin/registrar logo placeholder)
  - [ ] #2 Replace online user row with hierarchical dropdown + checkboxes (department admins/students/faculties) + search box
  - [ ] #3 Add message search UI: search icon/button beside close (×) and filter/highlight messages
  - [ ] #4 Make chat panel freely resizable via drag handle (Messenger-like)
  - [ ] #5 Add “add file” icon button beside message input, enforce 5MB limit (UI only) and disable actual sending until backend is implemented

## Phase 2 (Backend + DB)
- [ ] Extend DB schema in `network/init-db-schema.sql` (and/or migrations) for:
  - [ ] attachment/file fields for chat messages
  - [ ] delivery + seen timestamps / status
- [ ] Update backend:
  - [ ] `client-app/Models/ChatMessage.cs`
  - [ ] `client-app/Controllers/ChatHub.cs` (new hub methods/events)
  - [ ] `client-app/Services/IChatCache.cs`
  - [ ] `client-app/Services/ChatCache.cs`
- [ ] Frontend integration for #5 (file sending) and #6 (delivered/seen rendering)

# Mordin 
# WorksDone
[registerData.js,
studentSectioningHelpers.js,
login.jsx,
formulabuilder.jsx,
registrargradesview.jsx] 
- programs/courses fixed

- added back button in the monitoring

- removed the school year

- fixed the search bar

- fixed the headers

- added semester selection in encoding period

# to do:
# ***fix asap for proper work flow

- fix the academic assignment (chairperson portal)
** if kaya na igaya yung format ng faculty loading and manual section distribution same sa frontend pakicheck nalang if ano itsura sa repo namin. basta ayusin yung format na hindi nakakalito. 
- fix the for review (chairperson portal)
** dito hindi ko pa pala na-check if gumagana na to so wala pa pala aayusin dito di ko pa nakikita magkaroon ng laman.

