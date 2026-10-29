const express = require("express");
const path = require("node:path");
const cookieParser = require("cookie-parser");
const { pool, testConnection } = require("./db");
const { getJwtSecret } = require("./auth");
const authRoutes = require("./auth.routes");
const accountRoutes = require("./accounts.routes");
const ticketRoutes = require("./tickets.routes");
const staffTicketRoutes = require("./staff-tickets.routes");
const staffDeviceRoutes = require("./staff-devices.routes");
const staffAnalyticsRoutes = require("./staff-analytics.routes");
const maintenancePlanRoutes = require("./maintenance-plans.routes");
const { checkMysqldump, scheduleDailyBackup } = require("./backup");

const app = express();
const port = Number(process.env.PORT || 3000);
const clientBuildPath = path.resolve(__dirname, "../../client/dist");

app.use(express.json());
app.use(cookieParser());
app.get("/api/health", (_request, response) => {
  response.json({ status: "ok" });
});
app.use("/api/auth", authRoutes);
app.use("/api/accounts", accountRoutes);
app.use("/api/tickets", ticketRoutes);
app.use("/api/staff/tickets", staffTicketRoutes);
app.use("/api/staff/devices", staffDeviceRoutes);
app.use("/api/staff/maintenance-plans", maintenancePlanRoutes);
app.use("/api/staff", staffAnalyticsRoutes);
app.use("/api", (_request, response) => {
  response.status(404).json({ message: "API route not found." });
});
app.use(express.static(clientBuildPath));
app.get("/{*path}", (request, response, next) => {
  if (request.path.startsWith("/api/")) {
    response.sendStatus(404);
    return;
  }
  response.sendFile(path.join(clientBuildPath, "index.html"), (error) => {
    if (error) next(error);
  });
});
app.use((error, _request, response, _next) => {
  console.error(`Request failed: ${error.message}`);
  const statusCode = error.statusCode || (error.type === "entity.parse.failed" ? 400 : 500);
  response.status(statusCode).json({
    message: statusCode === 400 ? "Request body contains invalid JSON." : "An unexpected server error occurred.",
  });
});

async function start() {
  try {
    getJwtSecret();
    await testConnection();
    console.log("MySQL connection successful.");
    const backupTool = await checkMysqldump();
    if (backupTool.available) {
      scheduleDailyBackup();
      console.log("Daily MySQL backup scheduled for 2:00 AM.");
    } else {
      console.error(`Automatic MySQL backups are unavailable: ${backupTool.message}`);
    }
    app.listen(port, "0.0.0.0", () => {
      console.log(`BMC IT Service Desk listening on http://0.0.0.0:${port}`);
    });
  } catch (error) {
    console.error(
      `Unable to start: ${error.message}\nCheck server/.env for JWT_SECRET and database settings, and confirm the MySQL server is running.`,
    );
    await pool.end();
    process.exitCode = 1;
  }
}

start();
