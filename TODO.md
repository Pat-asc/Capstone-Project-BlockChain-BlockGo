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
