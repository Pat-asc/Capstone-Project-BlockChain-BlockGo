# File Changes Summary

This document lists the code/config changes made so far, grouped by project folder.

## middleware folder

### `middleware.js`

- Function/area: login token creation in the login/auth flow.
- Changes:
  - Updated JWT token options to use `process.env.JWT_EXPIRES_IN || '12h'`.
  - This prevents users from being logged out too quickly during normal system use.

### `nginx/default.conf`

- Function/area: Nginx reverse proxy routing.
- Changes:
  - Added `client_max_body_size 10m;` so chat/file uploads up to 5 MB can pass through Nginx.
  - Pointed backend proxy traffic to `host.docker.internal:5000` for the C# backend.
  - Pointed middleware proxy traffic to `host.docker.internal:4000`.
  - Kept `/api/login` routed to middleware.
  - Kept C# routes such as `/api/Auth/`, `/api/Grades`, and `/chatHub` routed to the C# backend.
  - This was done because middleware is running outside the containers/through WSL and should not be containerized.

## client-app folder

### `Program.cs`

- Function/area: SignalR configuration.
- Changes:
  - Added `MaximumReceiveMessageSize = 8 * 1024 * 1024`.
  - This allows SignalR chat/file payloads large enough for 5 MB attachments after encoding overhead.

### `Services/EmailService.cs`

- Function/area: OTP email logo rendering.
- Changes:
  - Updated OTP email logo handling to use an inline linked resource.
  - Set the logo content ID/link through `ContentLink`.
  - Set the linked image name using `ContentType.Name`.
  - Removed invalid `LinkedResource.ContentDisposition` usage that caused the C# backend build to fail.
  - This is meant to make `plvlogo.png` render more consistently in OTP emails.

### `Controllers/AuthController.cs`

- Function/area: registration, profile lookup, role handling.
- Changes:
  - Added/used `NormalizeSystemRole`.
  - Normalized department admin role variants such as `department_admin`.
  - Normalized roles during request access, user profile fetch, and pending/approved user queries.
  - This fixes blank-page/login routing issues when department admin accounts use different role naming formats.

### `Controllers/GradeController.cs`

- Function/area: grade save, grade upload, and grade conversion.
- Changes:
  - Added `BuildUploadedGradePayload`.
  - Added university grade conversion helper logic.
  - Updated bulk upload to accept `term`.
  - Updated uploaded grade handling so midterm/finals upload follows the active encoding term.
  - Changed grade recording to update existing grades instead of failing when the grade already exists on the ledger/database.
  - This fixes the “Failed to Save grades” issue when the grade already exists but should be updated.

## Frontend Folder

### `src/App.js`

- Function/area: login success, role routing, app-level session handling.
- Changes:
  - Added role normalization for department admin variants.
  - Routed normalized `department_admin` users to the department admin dashboard.
  - Removed automatic logout caused only by token expiry checks during app load.
  - Kept explicit logout behavior.
  - Still clears the token if the token format itself is invalid.

### `src/services/api.js`

- Function/area: shared API request wrapper and grade upload API.
- Changes:
  - Removed forced local logout/redirect on normal `401` or `403` API failures.
  - Kept API errors visible by throwing request errors instead of silently logging the user out.
  - Updated `batchUploadGrades` to accept and submit `term`.
  - This supports midterm/finals-specific uploads and avoids sudden logout behavior.

### `src/components/shared/Chat.jsx`

- Function/area: chat UI, recipients, message rendering, attachments.
- Changes:
  - Added oldest-first message sorting so new chat messages appear below previous messages.
  - Fixed chat conversation filtering so messages stay tied to the selected recipient.
  - Made the recipient dropdown close automatically after selecting a user.
  - Added persistent selected/open chat users.
  - Added support for up to two chat windows when registrar receives messages from different users.
  - Kept the main chat button as a single button.
  - Added total online users display.
  - Improved chat bubble sizing so bubbles resize based on message length.
  - Removed horizontal scrolling on chat bubbles.
  - Hid MIME-only messages such as `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`.
  - Added file upload size validation for 5 MB.
  - Added image detection/preview for image attachments.
  - Added click-to-enlarge image preview similar to Messenger.
  - Added dropdown search/scroll behavior for user selection.
  - Added hover background behavior for users inside the dropdown.

### `src/components/faculty/FacultyHeader.jsx`

- Function/area: faculty portal header.
- Changes:
  - Changed the header text under `Faculty Portal` to exactly `Welcome Faculty`.
  - Removed the dynamic `Welcome Ms/Mr ...` text from the top header.

### `src/components/faculty/FacultyPortal.jsx`

- Function/area: faculty grade encoding and grade upload.
- Changes:
  - Reads the active encoding term from the system setting.
  - Locks finals input during midterm encoding.
  - Locks midterm input during finals encoding.
  - Keeps upload available for the active encoding term.
  - Converts grades to university grade equivalents such as `1.00`, `1.25`, `1.50`, etc.
  - Sends the active encoding term during batch upload.
  - Keeps faculty classification display such as `part-time` or `full-time`.
  - Shows `Prof. {faculty name}` in the main faculty information card.

### `src/components/chairperson/DeptAdminGradesView.jsx`

- Function/area: department admin dashboard load and realtime data setup.
- Changes:
  - Adjusted realtime/loading hook placement so the department admin page can load properly instead of showing a blank page.
  - Keeps department admin connected to real backend data APIs for grades, sections, students, faculty, settings, and IPFS access.

### `src/components/chairperson/StudentSectioning.jsx`

- Function/area: department admin sectioning and roster management.
- Changes:
  - Added `rosterRef`.
  - Added `viewSectionRoster`.
  - Made `View Roster` scroll to the roster panel.
  - Enabled department admin roster editing through `canEditRoster = true`.
  - Allows department admin to view and edit roster data instead of only opening a non-editable view.

### `src/components/registrar/RegistrarStudentSectioning.jsx`

- Function/area: registrar sectioning and roster management.
- Changes:
  - Added `rosterRef`.
  - Added `viewSectionRoster`.
  - Made `View Students` scroll to the roster panel.
  - Keeps registrar roster view editable for student roster changes.

### `src/components/registrar/RegistrarSectionsCreated.jsx`

- Function/area: registrar created sections page.
- Changes:
  - Checked as part of the blank-page issue for registrar section pages.
  - Kept connected to the registrar sectioning flow so selecting the sidebar item should render the page instead of staying blank.

## network Folder

### `docker-compose-annex.yaml`

- Function/area: annex campus Postgres replica and Nginx container.
- Changes:
  - `postgres-annex` now waits on the main `postgres` service with `condition: service_healthy`.
  - Increased `postgres-annex` healthcheck tolerance using:
    - `retries: 30`
    - `start_period: 90s`
  - Keeps `nginx-shield-annex` running as a container while middleware remains outside the containers.

### `docker-compose-pubad.yaml`

- Function/area: pubad/department campus Postgres replica and Nginx container.
- Changes:
  - `postgres-pubad` now waits on the main `postgres` service with `condition: service_healthy`.
  - Increased `postgres-pubad` healthcheck tolerance using:
    - `retries: 30`
    - `start_period: 90s`
  - Removed the `postgres:${MAIN_CAMPUS_IP}` override so the replica uses Docker service DNS on `registrar-net`.
  - Keeps `nginx-shield-pubad` running as a container while middleware remains outside the containers.

### `full_deploy.sh`

- Function/area: full deployment database startup wait.
- Changes:
  - Increased Postgres startup wait time:
    - `postgres`: `180s`
    - `postgres-annex`: `300s`
    - `postgres-pubad`: `300s`
  - This gives Bitnami Postgres replicas more time to initialize before the script fails the deployment.

