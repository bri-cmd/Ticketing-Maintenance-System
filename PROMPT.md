# BMC IT Service Desk: build instructions

Build an internal IT service desk web app for "Brilliant Metal Craft and Machine Design OPC" (short name BMC). It runs only on the company LAN: no cloud, no subscriptions. I'm on Windows PowerShell where npm can be blocked, so use `npm.cmd` in terminal commands. I'm learning, so keep the code simple, readable, and commented where the logic isn't obvious. Exported images of my Figma design are in /design (when present). The Figma design is the source of truth for layout AND colors. Follow it.

## STACK
- server/: Node.js + Express + MySQL (mysql2 driver with a promise connection pool), bcryptjs, JWT in an httpOnly cookie
- Database settings come from server/.env (DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME). Provide server/.env.example. Never hardcode credentials, and keep .env out of git.
- database/schema.sql creates every table (InnoDB, utf8mb4, foreign keys, indexes; unique ticket_no and asset_tag). database/seed.sql (or a seed script) adds the starting data. Include a SQL snippet that creates the database `it_service_desk` and a dedicated user for the app. On startup, test the connection and print a clear error if MySQL is not reachable.
- client/: Vite + React (JavaScript) + Tailwind v4 + react-router-dom
- One port (3000) serves the built client and the API, listening on 0.0.0.0 so other PCs on the LAN can open http://<server-ip>:3000
- Root scripts: `npm run build`, `npm start`. A README explains how to run it and find the server IP.
- Look: professional and restrained, small rounded corners, system font. Use the colors from my Figma images in /design. If they differ from these defaults (navy #0F1F3D sidebar, primary blue #1E40AF, gold #C9A227 as a thin accent, background #F8FAFC, borders #E2E8F0), follow the images. Put the colors in one Tailwind theme file so they are easy to change. Use the logo from /design in the headers.

## ROLES
- Guest (no login), employee (account), technician, admin. IT creates every employee and IT account. There is NO sign-up. New accounts get a temporary password and must change it at first sign-in.

## DATA (MySQL)
- departments; users (full_name, username, email, department, role, password_hash, must_change_password, active)
- maintenance_plans: ONE plan per device type (PC monthly, Printer weekly), with interval and a checklist
- devices: asset_tag (unique), type (PC/Printer), brand, model, ram, motherboard, serial_no, department, location, assigned_user, status (Active/Retired), verification (Needs IT check / Verified), last_serviced, next_due, postponed_until, postpone_reason
- maintenance_logs: device, done_by, done_at, checklist_results, notes
- tickets: ticket_no (IT-0001...), requester_user (null for guests), guest_name, guest_email, department, device (nullable), device_text (what a guest typed), help_topic, summary, details, priority, source (Guest / Signed in / Walk-in), status (Open, In progress, Waiting for parts, Resolved, Closed), assigned_to, timestamps
- ticket_updates: ticket, user, note, old/new status, visible_to_requester (bool), created_at

## RULES
- Every database change is a new, sequentially numbered `.sql` file in `database/migrations/`; apply it with `npm run db:migrate`. Never ask the user to run migration SQL manually or as root.
- Saving a device automatically attaches its type's plan: next_due = last_serviced (if given) or today, plus the plan interval. No manual "add to schedule" step.
- Record checkup: sets last_serviced = today, next_due = today + interval, clears any postponement, and saves a maintenance_log. A repair ticket does NOT change maintenance dates.
- Postpone: moves next_due to a chosen date with a reason; last_serviced stays unchanged. Status badges: Overdue, Due soon (within 7 days), Postponed, On schedule.
- Devices entered by an employee at first sign-in start as "Needs IT check" and are assigned to them. A technician sets Verified at the first checkup.
- Guest devices: if the typed tag matches a device's asset_tag (case-insensitive), link it. Otherwise device stays null and the ticket shows "Not registered". Guests can never create devices. A technician can Add device or Link to existing device from the ticket.
- Employees see only their own tickets. A ticket note with "show to employee" checked appears as "Messages from IT" on their status page and on the guest status page.
- Guests check status with ticket number + email. Email sending is optional via SMTP env settings; if not configured, just log to the console.

## SCREENS
**Public:** Main page ("Welcome to BMC IT Support", buttons "Open a New Ticket" and "Check Ticket Status", header "Guest User | Sign in"); guest open-ticket form (email, device, full name, department, help topic, issue summary, details; Create Ticket / Cancel); ticket submitted; check ticket status; sign in.

**Employee:** first sign-in "Set up my computer" (skippable); My requests (table + My computer box with last/next maintenance); New request (My computer / shared printer from list / other, description, priority); request submitted; request status with progress bar and Messages from IT.

**IT staff** (sidebar groups: Tickets, Devices, Maintenance, Admin; each page has a small process step bar): Dashboard; Ticket queue; New walk-in ticket; Ticket detail (Details, History timeline, Update box with status, assignee, note, "show this note to the employee", and the device's last/next maintenance); Devices list; Add device; Device detail; Maintenance plans list; New maintenance plan; Maintenance schedule (Record checkup and Postpone per row); Record checkup form; Reports (CSV export); Employee accounts; IT accounts (admin only).

**Permissions:** technicians can't manage accounts or plans; only admins can.

## EXTRAS
- Daily automatic backup using mysqldump to server/backups/ with the date in the file name, keep the last 14. The mysqldump path is configurable in .env. Document in the README how to restore a backup.
- Validate input on client and server, parameterized SQL only, hashed passwords.
- Seed: admin (admin / ChangeMe123!, must change), departments (Accounting, HR, Sales, Operations, Warehouse, Management), the two plans, and a few sample employees, devices, and tickets.

## BUILD IN STAGES (stop after each so I can review)
- (a) project setup, MySQL schema and seed, connection test
- (b) sign-in, roles, employee and IT accounts
- (c) tickets: guest, employee, walk-in, queue, detail, status
- (d) devices and maintenance: devices, plans, schedule, record checkup, postpone
- (e) dashboard, reports, CSV export, backup, README

Do ONLY the stage I ask for. When it's done, run it, fix any errors, tell me how to test it, and wait for me.
