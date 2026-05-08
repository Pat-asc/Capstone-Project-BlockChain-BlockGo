# Work Breakdown Structure Dictionary (WBSD) - BlockGo

| Level | Code | Name | Description | Predecessors | Duration (Days) | Owner |
|-------|------|------|-------------|--------------|-----------------|-------|
| 2 | 1.1 | Registration of User Accounts | Registrar registers Faculty and Students and issues digital identities. | N/A | N/A | |
| 3 | 1.1.1 | Register Faculty Account | Registrar enters Faculty details to issue blockchain access certificates. | N/A | 5 | |
| 3 | 1.1.2 | Register Student Account | Registrar or Professors register Students and issue access certificates. | 1.1.1 | 5 | |
| 2 | 1.2 | Display of Student Academic Profile | Portal shows students their personal info and academic performance. | N/A | N/A | |
| 3 | 1.2.1 | Display Personal Details and Subject Breakdown | System displays personal details and subject grades upon login. | 1.1.2 | 5 | |
| 2 | 1.3 | Triggering of Failure Notification | System alerts students who fail two or more subjects. | N/A | N/A | |
| 3 | 1.3.1 | Display Warning Alert in Portal | Portal triggers a warning for two or more failing grades. | 1.2.1 | 3 | |
| 2 | 1.4 | Connecting with Registrar | Chat interface for students to contact the Registrar about grades. | N/A | N/A | |
| 3 | 1.4.1 | Send Message to Registrar | Allows sending chat messages and blocks empty submissions. | 1.2.1 | 4 | |
| 2 | 1.5 | Enabling of Dynamic Flagging | Faculty flags student records for Chairperson review. | N/A | N/A | |
| 3 | 1.5.1 | Flag Student Row for Review | Enables row flagging and notifies if already flagged. | 1.14.1 | 3 | |
| 2 | 1.6 | Display of Encoding Status Banners | Dynamic banners show the current grade encoding status. | N/A | N/A | |
| 3 | 1.6.1 | Show Open/Urgent/Closed Banner | Banners indicate if encoding is open, urgent, or closed. | 1.11.1 | 4 | |
| 2 | 1.7 | Computation via Automated Grade Calculation | Automated calculation of final standings from faculty inputs. | N/A | N/A | |
| 3 | 1.7.1 | Compute Final Grade and Equivalent | Computes final grades in real-time and validates numeric scores. | 1.15.1 | 5 | |
| 3 | 1.7.2 | Determine Pass/Fail Status | System assigns pass or fail status based on final grades. | 1.7.1 | 3 | |
| 2 | 1.8 | Filtering of Sections | Faculty can filter and navigate assigned class sections. | N/A | N/A | |
| 3 | 1.8.1 | Filter Sections by Year Level | Faculty can narrow displayed sections by year level. | 1.6.1 | 3 | |
| 3 | 1.8.2 | Search Sections by Academic Program | Search tool returns sections matching an academic program. | 1.8.1 | 3 | |
| 2 | 1.9 | Tracking of Encoding Progress | Real-time progress tracking for grade encoding tasks. | N/A | N/A | |
| 3 | 1.9.1 | Display Progress Indicator per Section | Displays completion percentage for grades on section cards. | 1.10.2 | 2 | |
| 2 | 1.10 | Uploading via Administrative Submission | Faculty forwards finalized grades for Chairperson approval. | N/A | N/A | |
| 3 | 1.10.1 | Submit Finalized Grades to Chairperson | Initiates grade submission and notifies the Chairperson. | 1.13.1 | 4 | |
| 3 | 1.10.2 | Block Submission with Incomplete Grades | Blocks submission if any grade entries are missing. | 1.10.1 | 3 | |
| 2 | 1.11 | Display of Faculty Profile | Portal summarizes Faculty professional and profile info. | N/A | N/A | |
| 3 | 1.11.1 | Display Full Name, Faculty ID, Sections, and Classification | Displays name, ID, section count, and classification. | 1.1.1 | 3 | |
| 2 | 1.12 | Display of Section Metadata | Shows cards with full details for every assigned section. | N/A | N/A | |
| 3 | 1.12.1 | Render Section Card with Full Details | Renders cards with Subject, Schedule, and Student totals. | 1.8.2 | 4 | |
| 2 | 1.13 | Exporting of Grade Summary | Produces formal grading documents for specific sections. | N/A | N/A | |
| 3 | 1.13.1 | Generate PDF Grading Sheet | Generates downloadable PDF sheets of encoded grades. | 1.14.1 | 5 | |
| 2 | 1.14 | Management of Student Standing | Records non-standard academic statuses for students. | N/A | N/A | |
| 3 | 1.14.1 | Update Student Academic Status via Dropdown | Dropdown menu for marking records as Dropped, INC, or W. | 1.7.2 | 4 | |
| 2 | 1.15 | Uploading of Multiple Grade Records | Efficient bulk encoding of grades with duplicate checks. | N/A | N/A | |
| 3 | 1.15.1 | Upload Excel Grade File | Uploads Excel files with 50+ records directly to the ledger. | 1.34.1 | 3 | |
| 2 | 1.16 | Addition of Individual Student Grades | Adds student subject grades for a student in one session. | N/A | N/A | |
| 3 | 1.16.1 | Add Grade in Session Window | Validates and writes multiple grades without closing session. | 1.15.1 | 6 | |
| 2 | 1.17 | Assignment of Academic Sections to Faculty | Chairperson assigns class sections to departmental Faculty. | N/A | N/A | |
| 3 | 1.17.1 | Assign Students and Sections to Faculty | Links one or more sections to a selected Faculty member. | 1.18.1 | 5 | |
| 2 | 1.18 | Uploading of Section List | Chairperson uploads and assigns class roster files to Faculty. | N/A | N/A | |
| 3 | 1.18.1 | Upload and Store to Assign Section List | Uploads assigned sections directly to Faculty dashboards. | 1.21.1 | 5 | |
| 2 | 1.19 | Oversight of Faculty Progress via Dashboard | Chairperson monitors grade encoding across all Faculty. | N/A | N/A | |
| 3 | 1.19.1 | Display Real-Time Encoding Status | Monitoring dashboard shows departmental encoding status. | 1.10.2 | 4 | |
| 2 | 1.20 | Distribution of Finalized Grades After Season Closure | Registrar publishes approved grades after the encoding season ends. | N/A | N/A | |
| 3 | 1.20.1 | Distribute Finalized Grades Upon Season Closure | Sends finalized grades to students once encoding is closed and validated. | 1.26.1 | 5 | |
| 2 | 1.21 | Receiving of Student List from Registrar | Chairperson accesses official student lists from Registrar. | N/A | N/A | |
| 3 | 1.21.1 | Notify Chairperson of Uploaded Student List | Notifies Chairperson when new student lists are available. | 1.32.1 | 4 | |
| 2 | 1.22 | Oversight of Departmental Grades | Chairperson views all encoded grades in the department. | N/A | N/A | |
| 3 | 1.22.1 | Display All Grades by Department | Dashboard displays all Faculty grades or an empty state. | 1.19.1 | 4 | |
| 2 | 1.23 | Monitoring of Flagged Records | Chairperson filters records marked for special review. | N/A | N/A | |
| 3 | 1.23.1 | Notify and Display Flagged Records | Filters dashboard to show only flagged student records. | 1.19.1 | 2 | |
| 2 | 1.24 | Management of Grade Revision Workflow | Chairperson returns grade submissions for corrections. | N/A | N/A | |
| 3 | 1.24.1 | Return Submission to Faculty for Correction | Reverts submission status for Faculty to fix discrepancies. | 1.10.1 | 4 | |
| 2 | 1.25 | Revision Notes | Chairperson attaches explanatory notes for returned grades. | N/A | N/A | |
| 3 | 1.25.1 | Deliver specific revision notes alongside returned tasks. | The system must allow the Chairperson to attach a specific revision note to a returned submission. | 1.24.1 | 3 | |
| 2 | 1.26 | Submission via Final Validation | Chairperson reviews grades before forwarding to Registrar. | N/A | N/A | |
| 3 | 1.26.1 | Finalizes Faculty-encoded grades and sends them to Registrar. | The system must allow the Chairperson to review all Faculty-encoded grades, approve the submission, and forward to Registrar. | 1.25.1 | 4 | |
| 2 | 1.27 | Filtering of Student Status | Chairperson filters departmental records by academic status. | N/A | N/A | |
| 3 | 1.27.1 | Filter Departmental Records by Academic Status | Returns only records matching selected academic status. | 1.25.1 | 3 | |
| 2 | 1.28 | Enforcement of Access Control | Restricts ledger operations based on roles and ABAC. | N/A | N/A | |
| 3 | 1.28.1 | Enforce ABAC for Faculty Writes | Verifies attributes before allowing Faculty write actions. | 1.1.1 | 7 | |
| 3 | 1.28.2 | Enforce ABAC for Registrar Queries | Permits Registrar to query full ledger grade records. | 1.28.1 | 5 | |
| 3 | 1.28.3 | Block Unauthorized Ledger Actions | Blocks unauthorized Student or user ledger submissions. | 1.28.2 | 4 | |
| 2 | 1.29 | Revocation of User Access | Registrar immediately revokes system access for Faculty. | N/A | N/A | |
| 3 | 1.29.1 | Revoke Faculty Certificate | Updates revocation lists and bars account access immediately. | 1.28.3 | 5 | |
| 3 | 1.29.2 | Detect Already-Revoked Account | Detects and notifies if an account is already inactive. | 1.29.1 | 2 | |
| 2 | 1.30 | Resetting of Encoding Season | Registrar resets encoding for the new academic year. | N/A | N/A | |
| 3 | 1.30.1 | Reset Encoding Season | Clears section assignments and archives old records. | 1.35.1 | 5 | |
| 2 | 1.31 | System-Wide Overview | Registrar has a system-wide overview of grade encoding. | N/A | N/A | |
| 3 | 1.31.1 | Display System-Wide Encoding Overview Dashboard | Dashboard shows encoding progress for every department. | 1.26.1 | 4 | |
| 2 | 1.32 | Distribution of Student Lists | Registrar distributes student lists to each Chairperson. | N/A | N/A | |
| 3 | 1.32.1 | Distribute Student List to Chairperson | Uploads rosters via CSV and notifies department heads. | 1.1.2 | 5 | |
| 2 | 1.33 | Grade Record History Retrieval | Retrieval of history for any grade record changes. | N/A | N/A | |
| 3 | 1.33.1 | Retrieve Grade Record History | Queries blockchain for chronological logs of record updates. | 1.31.1 | 6 | |
| 3 | 1.33.2 | Restrict Audit Trail Access by Role | Blocks Student access to immutable audit trail history. | 1.33.1 | 3 | |
| 2 | 1.34 | Management of Encoding Period Control | The Registrar must have authority over the grade encoding schedule. | N/A | N/A | |
| 3 | 1.34.1 | Set Encoding Start and End Dates | Sets start and end dates to trigger appropriate banners. | 1.17.1 | 4 | |
| 2 | 1.35 | PDF Summaries Generation | Registrar generates PDF summaries of encoded grades. | N/A | N/A | |
| 3 | 1.35.1 | Generate PDF Grade Form Summary | Generates PDF grade forms for sections or Faculty members. | 1.20.1 | 4 | |
| 2 | 1.36 | System Activity Logs Monitoring | Admin monitors and exports system activity logs. | N/A | N/A | |
| 3 | 1.36.1 | View Activity Log by Date Range | Displays chronological logs filtered by a selected date range. | 1.33.2 | 5 | |
| 3 | 1.36.2 | Export Activity Log as PDF | Downloads the active activity log dashboard as a PDF. | 1.36.1 | 4 | |
