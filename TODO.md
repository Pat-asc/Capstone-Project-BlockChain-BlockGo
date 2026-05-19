# TODO

## Project task: NGINX-shield redundancy

- [x] Inspect nginx default.conf routing and confirm hard dependencies on nginx-shield containers
- [x] Update docker-compose files to ensure core services (backend/middleware/fabric/ipfs) run independently from nginx-shield
- [x] If any service depends_on nginx-shield, remove/adjust it (or use optional behavior)
- [x] Add healthchecks / graceful startup so removing one nginx-shield does not break others
- [x] Test: start stack with one nginx-shield stopped/removed and verify backend/middleware endpoints still reachable

##
- [x] Fix Bulk Upload Function (pls priority this, may ui na sa registrar)
- [x] Add Revoke Account

##
- [x] Bulk Upload lang napapasa sa chairperson, pag manual na type not working di na kikita sa for review ng chairperson. 
- [x] Yung return to faculty function di gumagana.
- [x] Pa-check yung revoke account, last check ko na-revoke account, hindi na nakakalogin pero still showing sa system na pwede pa ulit i-revoke.
- [x] Update Student Info button (Bulk Enroll), may error kapag nag update ng info ng student. Yung csv na gamit dito is same lang sa pag Upload Student (Bulk Enroll)


- [x] ayos flow encoding ng grades pag midterm pero pag pinalitan na ng final term. kapag nag encode and submit to chairperson hindi nagkakaroon ng status na submitted to chairperson pero pag nagcheck ng account ng chairperson pumasok yung grades kahit na mark sa faculty acc

- [x] return to faculty function hindi rin gumagana during final term pero kapag midterm is gumagana

- [x] Paayos ng distribution dapat magkaroon muna ng final grades bago pwede madistribute sa students

- [x] Chat newest message hindi na dapat umaakyat; auto-scroll na sa latest message.

- [x] Cross-port refresh para sa registrar/chairperson data updates across 8080, 8090, at 8100.

- [x] Chairperson sectioning fallback sa backend records para magreflect ang bootstrapped/assigned students kahit ibang port ginamit.

###
to do

- students should be able to view previous semester grades
- updates student details in the section creation [/]
- should be able to update grades even it was bulk uploaded [/]
- no sign up for the faculty same with the chairperson [/]
- status of encoded grades [/]
- add a indication that encoded grades has inc information [/]
- registrar can now reject grades [/]

###
latest applied requests / traceback

- [x] Student portal: added previous semester grades filter with school year dropdown and semester dropdown.
- [x] Student portal: added TOR preview, print, and save PDF flow.
- [x] Student portal: TOR print/save is blocked with "complete your course years before printing" when 4 course years are not complete.
- [x] Faculty grading: attendance grade is optional and grade computation still works when attendance is blank.
- [x] Faculty grading: remarks is now a dropdown only: D, UD, U, W.
- [x] Faculty grading: missing midterm or final grade automatically marks remarks as INC / incomplete.
- [x] Faculty grading: flagging is automatic only, no manual flag button.
- [x] Faculty grading: students are flagged only when they have missing grades or selected remarks.
- [x] Faculty grading: warning modal remains before submitting missing-grade records, with Cancel, red Submit, then Yes/Cancel confirmation.
- [x] Registrar / ledger: missing attendance becomes "not applicable" in IPFS/ledger output.
- [x] Registrar: "Register Students" changed to "Register User".
- [x] Registrar: faculty bulk upload added/checked and does not require faculty ID number.
- [x] Auth: signup/request access flow removed from login page.
- [x] Responsive UI: updated affected student/faculty/registrar screens to avoid desktop-only behavior.
- [x] Access rule: when both midterm and final grades are missing, student is considered inactive and access revocation is triggered on submit.
- [x] Access rule: students with complete midterm and final grades and no remarks remain active.

###
possible next issues to verify

- [ ] Run frontend build when Node/npm is available.
- [ ] Run backend build when dotnet is available.
- [ ] Test real registrar finalize-to-ledger flow and confirm attendance displays as "not applicable" in IPFS.
- [ ] Test missing both midterm/final grades with a real student account and confirm login access is revoked after submit.
- [ ] Test missing only one grade and confirm student becomes incomplete/flagged but access is not revoked.
- [ ] Test selected remarks D, UD, U, W and confirm flag/status reaches chairperson and registrar review correctly.
- [ ] Test TOR PDF generation in browser with jsPDF loaded.

###
latest applied requests / traceback - reset season and irregular students

- [x] Reset encoding season now clears pending grade records.
- [x] Reset encoding season now clears faculty assigned sections.
- [x] Reset encoding season now clears created academic sections.
- [x] Reset encoding season now clears sectioning shared state such as registrar assignments, student sections, irregular assignments, and chairperson section reviews.
- [x] Reset encoding season now removes temporary students marked as temporary/irregular.
- [x] Registrar side now has an Add Temporary Student form under Register User.
- [x] Temporary students are saved as irregular and temporary.
- [x] Faculty/registrar student queries now carry temporary and irregular status fields.
- [x] Missing midterm or final grade now uses irregular status format such as irreg:INC.
- [x] Registrar grade monitoring recognizes irreg:* records as priority/non-active records.

###
possible next issues to verify - reset season and irregular students

- [ ] Test Reset Encoding Season in registrar and confirm AcademicSections and FacultySections are empty after reset.
- [ ] Test Reset Encoding Season and confirm temporary irregular student accounts are removed.
- [ ] Test Add Temporary Student and confirm the student appears as Irregular/Temporary on registrar side.
- [ ] Test a temporary student assigned to an existing section and confirm the faculty can see the student in grade encoding.
- [ ] Test missing midterm only, missing final only, and both missing to confirm registrar status shows irreg:INC.
