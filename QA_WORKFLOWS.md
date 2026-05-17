# PLV BlockGO QA Workflows

Guide ito para mabilis i-test ang mga inayos sa system. Simple steps lang ang nakalagay dito para madaling sundan habang QA.

## Quick Health Check

- Buksan ang system sa tatlong links:
  - `http://localhost:8080`
  - `http://localhost:8090`
  - `http://localhost:8100`
- Dapat pare-pareho ang logo, name, login page, at dashboard na lalabas.
- Kung lumang page or logo pa rin ang lumabas, mag hard refresh muna.

## Chat Workflow

Goal: gumana ang chat kahit magkaibang port ang gamit ng users.

### Test Setup

- User 1: Registrar
- User 2: Faculty
- Login sila sa magkaibang port, halimbawa:
  - Registrar sa `8080`
  - Faculty sa `8090`

### Delivered Test

1. Buksan ang chat ni Registrar.
2. Mag-send si Registrar ng message kay Faculty.
3. Huwag muna buksan ni Faculty ang chat conversation ni Registrar.
4. Sa side ni Registrar, dapat `Delivered` ang lalabas.
5. Hindi pa dapat magiging `Seen`.

Expected result: `Delivered` lang kapag hindi pa binubuksan ni Faculty ang chat.

### Seen Test

1. Sa Faculty account, buksan ang chat conversation ni Registrar.
2. Tingnan ulit sa Registrar account.
3. Dapat maging `Seen` na yung message.

Expected result: `Seen` lang kapag binuksan na talaga ng receiver ang chat.

### Faculty Reply Test

1. Sa Faculty account, mag-send ng reply kay Registrar.
2. Sa Registrar side, huwag muna buksan ang Faculty chat.
3. Sa Faculty side, dapat `Delivered` muna.
4. Kapag binuksan ni Registrar ang Faculty chat, dapat magiging `Seen`.

Expected result: pareho dapat ang behavior pabalik.

### Typing Dots Test

1. Buksan ni Registrar ang chat ni Faculty.
2. Sa Faculty side, mag-type pero huwag muna i-send.
3. Sa Registrar side, dapat may lumabas na tatlong animated dots.
4. Tumigil mag-type si Faculty.
5. Dapat mawala ang dots after short delay.
6. Kapag nag-send or nagpalit ng ka-chat, dapat mawala rin ang dots.

Expected result: lalabas lang ang typing dots sa tamang kausap.

### Cross-Port Test

Ulitin ang chat test gamit ang ibang combination:

- Registrar `8080`, Faculty `8090`
- Registrar `8090`, Faculty `8100`
- Registrar `8100`, Faculty `8080`

Expected result: pareho pa rin ang behavior sa lahat ng ports.

## Faculty Grade Encoding Workflow

Goal: kapag final term na, tama pa rin ang submit status papunta sa Chairperson.

1. Login as Faculty.
2. Pumunta sa assigned section.
3. Siguraduhin na final term ang active encoding period.
4. Maglagay ng final grades.
5. I-click ang `Submit to Chairperson`.
6. Dapat mag-lock ang grades sa Faculty side.
7. Dapat lumabas ang status na submitted.
8. Login as Chairperson.
9. Dapat makita ng Chairperson ang submitted grades.

Expected result: hindi dapat mukhang draft sa Faculty side kapag na-submit na.

## Return to Faculty Workflow

Goal: gumana ang return kahit final term.

1. Login as Chairperson.
2. Buksan ang submitted section.
3. Piliin ang return or send back action.
4. Maglagay ng note.
5. Submit return.
6. Login as Faculty.
7. Buksan ang same section.
8. Dapat makita ang returned status at note.
9. Dapat puwedeng ayusin ulit ang grades.

Expected result: kapag binalik ng Chairperson, bumabalik sa Faculty with note.

## Final Grade Release Workflow

Goal: hindi puwedeng i-release sa students kung wala pang final grades.

1. Login as Registrar.
2. Pumunta sa finalization or grade release area.
3. Tingnan ang sections na may midterm lang.
4. Dapat hindi pa puwedeng i-publish sa students.
5. Kapag may complete final grades na ang sections, saka lang dapat maging ready for release.
6. I-publish kapag ready na.
7. Login as Student.
8. Dapat makita lang ng student ang grades na na-release na.

Expected result: hindi lalabas sa students ang grades hangga't kulang pa ang finals.

## Current Fix Checklist

- [x] Chat can work across `8080`, `8090`, and `8100`.
- [x] Faculty can send messages to Registrar.
- [x] Message shows `Delivered` first when receiver has not opened the chat.
- [x] Message shows `Seen` only after receiver opens the chat conversation.
- [x] Typing dots show while the other user is typing.
- [x] Final-term submit to Chairperson keeps a submitted status.
- [x] Return to Faculty supports final-term grades.
- [x] Student release waits for complete final grades.

## Automated Checks Already Done

- [x] Website build finished successfully.
- [x] Backend build finished successfully.
- [x] Backend is running and healthy.
- [x] Redis is running and healthy.
- [x] All three website ports are running and healthy.
- [x] `8080`, `8090`, and `8100` all show `PLV BlockGO`.
- [x] `8080`, `8090`, and `8100` all serve the latest website bundle.
- [x] Default Registrar login worked on all three ports.
- [x] Authenticated chat connection check worked on all three ports.
- [x] Final manual QA still needed for the real two-user chat behavior because it needs one Registrar account and one Faculty account logged in at the same time.

## Notes for QA

- Test with two different browsers or one normal window plus one incognito window.
- If a page looks old, hard refresh first.
- For chat, always note which port each user is using.
- If something fails, write down:
  - user role,
  - port used,
  - exact button clicked,
  - expected result,
  - actual result.
