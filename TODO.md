# TODO

## Project task: NGINX-shield redundancy

- [ ] Inspect nginx default.conf routing and confirm hard dependencies on nginx-shield containers
- [ ] Update docker-compose files to ensure core services (backend/middleware/fabric/ipfs) run independently from nginx-shield
- [ ] If any service depends_on nginx-shield, remove/adjust it (or use optional behavior)
- [ ] Add healthchecks / graceful startup so removing one nginx-shield does not break others
- [ ] Test: start stack with one nginx-shield stopped/removed and verify backend/middleware endpoints still reachable

##
- [ ] Fix Bulk Upload Function (pls priority this, may ui na sa registrar)
- [ ] Add Revoke Account
