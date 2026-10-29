# BMC IT Service Desk

Internal IT service desk for Brilliant Metal Craft and Machine Design OPC. The
application runs on the company LAN and serves the React client and API from
port 3000.

## Requirements

- Windows 10/11
- Node.js LTS and npm
- MySQL 8.0
- MySQL Workbench (for initial database setup)
- `mysqldump.exe` from MySQL Server 8.0

## 1. Install the project

Open PowerShell in the project folder and install dependencies:

```powershell
npm.cmd install
```

## 2. Create the database and application user

In MySQL Workbench, connect as a MySQL administrator and run this setup once.
Replace the example password with a strong, unique password:

```sql
CREATE DATABASE IF NOT EXISTS it_service_desk
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

CREATE USER IF NOT EXISTS 'it_service_desk_app'@'127.0.0.1'
  IDENTIFIED BY 'REPLACE_WITH_A_LONG_RANDOM_PASSWORD';

GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES,
      SHOW VIEW, TRIGGER, EVENT
ON it_service_desk.* TO 'it_service_desk_app'@'127.0.0.1';

FLUSH PRIVILEGES;
```

If MySQL is on another machine, create the user for the service desk server's
LAN address instead of `localhost`, and configure the MySQL server firewall
accordingly. Do not expose MySQL to the public internet.

Open `database/schema.sql` in Workbench and execute it against the
`it_service_desk` database. This creates the tables and indexes.

## 3. Configure the server

Copy the example environment file:

```powershell
Copy-Item server/.env.example server/.env
```

Edit `server/.env` and set `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`,
`DB_NAME`, and `JWT_SECRET`. Generate a random secret of at least 32 characters.
For example:

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Set `MYSQLDUMP_PATH` to the full path of `mysqldump.exe`. The default example
uses:

```text
C:/Program Files/MySQL/MySQL Server 8.0/bin/mysqldump.exe
```

Quote the value in `.env` if the path contains spaces. If `mysqldump.exe` cannot
be run, the server logs a clear backup warning and the admin backup action
displays the failure.

Keep `server/.env` private. It contains database credentials and is excluded
from Git.

## 4. Run migrations and seed the database

`database/schema.sql` is the complete current schema. Because it already
contains the changes represented by the existing numbered migrations, record
those files as applied when initializing a database from that schema:

```powershell
npm.cmd run db:migrate -- --baseline
```

For an existing database whose migration files are already recorded, use:

```powershell
npm.cmd run db:migrate
```

The migration runner applies pending files in filename order and records each
success in `schema_migrations`. Do not baseline a database that is missing
schema changes from any existing migration. A new numbered SQL migration is
not required for stage (e): it adds no database tables or columns.

Seed initial departments, plans, sample devices, and accounts once:

```powershell
npm.cmd run db:seed
```

The seed creates the initial `admin` account with temporary password
`ChangeMe123!`; the first sign-in requires a password change. Do not rerun the
seed against a live database because it resets seeded account passwords.

If a future migration needs schema privileges, grant the configured migration
user the required privileges before running `npm.cmd run db:migrate`. Keep
database administrator credentials out of application source files and logs.

## 5. Build and start

Build the client and start the application:

```powershell
npm.cmd run build
npm.cmd start
```

The server tests the MySQL connection at startup and listens on all network
interfaces at `http://<server-ip>:3000`. Keep the server process running while
staff use the system.

## Find the server IP

On the Windows PC running the service, open PowerShell and run:

```powershell
ipconfig
```

Use the IPv4 address under the active Ethernet or Wi-Fi adapter, for example
`http://192.168.1.25:3000`. Allow inbound TCP port 3000 through Windows
Defender Firewall only on the trusted company LAN/private network.

## Dashboard and reports

Technicians and admins can open **Dashboard** for current ticket and
maintenance metrics and **Reports** for month- and department-filtered ticket
reports. Reports show received and resolved ticket counts, average resolution
time, tickets by department and help topic, and the current on-schedule device
percentage. Admins can export filtered ticket and maintenance-log CSV files.

## Automatic and manual database backups

When `mysqldump.exe` is available, the server runs a backup daily at 2:00 AM
local server time. Admins can also choose **Back up now** on the Reports page.
Files are written to `server/backups/` with the database name and date/time in
the filename. The newest 14 backup files are retained.

The backup process passes the database password through a short-lived,
restricted MySQL option file, not on the command line. The temporary file is
removed after the dump completes or fails. Backups contain service desk data;
restrict access to the server and its backup directory and copy backups to an
approved protected location if required by company policy.

### Restore a backup

1. Stop the service desk server.
2. Ensure the target `it_service_desk` database exists.
3. From PowerShell, restore the selected `.sql` file using the MySQL client.
   The `-p` option prompts for the database user's password; do not put the
   password in this command:

```powershell
& "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe" `
  --host=127.0.0.1 --port=3306 --user=it_service_desk_app -p `
  it_service_desk -e "source C:/full/path/to/server/backups/it_service_desk_YYYY-MM-DD_HHMMSS.sql"
```

4. Restart the application and verify that staff can sign in and the expected
   tickets and devices are present.

## Before real use

- Replace all seeded passwords and require users to change temporary passwords.
- Set a unique random `JWT_SECRET`; do not reuse the example value.
- Set a strong MySQL password and limit database/network access to the LAN.
- Configure and verify `MYSQLDUMP_PATH`; periodically test restoring a backup.
- Review seeded sample accounts and data, then remove or replace them before
  production.
- Use HTTPS if the service is ever exposed beyond a trusted LAN; do not expose
  the application or MySQL directly to the public internet.
