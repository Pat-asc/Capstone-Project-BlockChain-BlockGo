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

- implemented academic assignment faculty loading in the chairperson portal
  - kept the existing Faculty Loading CSV workflow
  - added manual/automatic load mode tracking
  - updated distributed faculty loading records with mode badges and counts

# to do:
# ***fix asap for proper work flow

- [x] fix the academic assignment (chairperson portal)
** faculty loading and manual faculty loading implemented; CSV workflow kept unchanged.

- [x] fix the for review (chairperson portal)
** faculty submissions now sync to the chairperson review queue; For Review auto-selects the first submitted section when available.

