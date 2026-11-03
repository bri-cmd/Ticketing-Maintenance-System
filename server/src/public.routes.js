const express = require("express");
const { pool } = require("./db");

const router = express.Router();
const requestWindowMs = 60 * 1000;
const requestLimit = 60;
const requestsByIp = new Map();

const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of requestsByIp) {
    if (now - entry.startedAt >= requestWindowMs) requestsByIp.delete(ip);
  }
}, requestWindowMs);
cleanupTimer.unref();

function rateLimitByIp(request, response, next) {
  const ip = request.ip || request.socket.remoteAddress || "unknown";
  const now = Date.now();
  let entry = requestsByIp.get(ip);
  if (!entry || now - entry.startedAt >= requestWindowMs) {
    entry = { startedAt: now, count: 0 };
    requestsByIp.set(ip, entry);
  }
  if (entry.count >= requestLimit) {
    response.set("Retry-After", String(Math.ceil((entry.startedAt + requestWindowMs - now) / 1000)));
    response.status(429).json({ message: "Too many device searches. Please try again shortly." });
    return;
  }
  entry.count += 1;
  next();
}

router.get("/devices", rateLimitByIp, async (request, response) => {
  const departmentValue = request.query.department_id;
  const departmentId = departmentValue === undefined || departmentValue === ""
    ? null
    : Number(departmentValue);
  const query = request.query.q === undefined ? "" : request.query.q;
  if (departmentValue !== undefined && departmentValue !== ""
    && (!Number.isInteger(departmentId) || departmentId < 1)) {
    response.status(400).json({ message: "Choose a valid department." });
    return;
  }
  if (typeof query !== "string" || query.trim().length > 100) {
    response.status(400).json({ message: "Device search must be 100 characters or fewer." });
    return;
  }
  const search = query.trim();
  if (departmentId === null && search.length < 2) {
    response.json({ devices: [] });
    return;
  }
  if (departmentId !== null) {
    const [departments] = await pool.execute(
      "SELECT id FROM departments WHERE id = ? AND active = TRUE",
      [departmentId],
    );
    if (!departments.length) {
      response.status(400).json({ message: "Choose an active department." });
      return;
    }
  }

  const like = `%${search}%`;
  const [rows] = await pool.execute(
    `SELECT device.id, device.asset_tag AS label, device.type, device.brand,
            device.model, department.name AS department, device.location
     FROM devices device
     LEFT JOIN departments department ON department.id = device.department_id
     WHERE device.status = 'Active'
       AND (? IS NULL OR device.department_id = ?)
       AND (? = '' OR device.asset_tag LIKE ?
            OR COALESCE(device.brand, '') LIKE ?
            OR COALESCE(device.model, '') LIKE ?)
     ORDER BY CASE device.type WHEN 'PC' THEN 0 ELSE 1 END,
              department.name, device.asset_tag
     LIMIT 50`,
    [departmentId, departmentId, search, like, like, like],
  );
  response.json({
    devices: rows.map((device) => ({
      id: device.id,
      label: device.label,
      type: device.type,
      brand: device.brand,
      model: device.model,
      department: device.department,
      location: device.location,
    })),
  });
});

module.exports = router;
