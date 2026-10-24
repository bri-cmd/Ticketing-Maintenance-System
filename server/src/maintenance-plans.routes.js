const express = require("express");
const { pool } = require("./db");
const {
  requirePasswordChangeComplete,
  requireRole,
  requireUser,
} = require("./auth");

const router = express.Router();
const deviceTypes = new Set(["PC", "Printer"]);
const intervalUnits = new Set(["day", "week", "month"]);

router.use(requireUser, requirePasswordChangeComplete, requireRole("technician", "admin"));

function checklistFromDatabase(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

router.get("/", async (_request, response) => {
  const [rows] = await pool.execute(
    `SELECT plan.id, plan.name, plan.device_type, plan.interval_value,
            plan.interval_unit, plan.checklist,
            COALESCE(device_counts.device_count, 0) AS device_count
     FROM maintenance_plans plan
     LEFT JOIN (
       SELECT type, COUNT(*) AS device_count
       FROM devices
       GROUP BY type
     ) device_counts ON device_counts.type = plan.device_type
     ORDER BY plan.device_type`,
  );
  response.json({
    plans: rows.map((plan) => ({
      id: plan.id,
      name: plan.name,
      deviceType: plan.device_type,
      intervalValue: plan.interval_value,
      intervalUnit: plan.interval_unit,
      checklist: checklistFromDatabase(plan.checklist),
      deviceCount: plan.device_count,
    })),
  });
});

router.put("/:deviceType", requireRole("admin"), async (request, response) => {
  const deviceType = request.params.deviceType;
  const body = request.body || {};
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const intervalValue = Number(body.intervalValue);
  const intervalUnit = body.intervalUnit;
  const checklist = Array.isArray(body.checklist)
    ? body.checklist.map((item) => typeof item === "string" ? item.trim() : "")
    : [];
  if (!deviceTypes.has(deviceType)) {
    response.status(400).json({ message: "Choose PC or Printer as the device type." });
    return;
  }
  if (!name || name.length > 120 || !Number.isInteger(intervalValue)
    || intervalValue < 1 || intervalValue > 3650 || !intervalUnits.has(intervalUnit)) {
    response.status(400).json({ message: "Enter a plan name and valid maintenance interval." });
    return;
  }
  if (checklist.length < 1 || checklist.length > 50
    || checklist.some((item) => !item || item.length > 255)) {
    response.status(400).json({ message: "Add between 1 and 50 checklist items, each up to 255 characters." });
    return;
  }
  await pool.execute(
    `INSERT INTO maintenance_plans
      (name, device_type, interval_value, interval_unit, checklist)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       name = VALUES(name),
       interval_value = VALUES(interval_value),
       interval_unit = VALUES(interval_unit),
       checklist = VALUES(checklist)`,
    [name, deviceType, intervalValue, intervalUnit, JSON.stringify(checklist)],
  );
  response.json({ message: `${deviceType} maintenance plan saved.` });
});

module.exports = router;
