const express = require("express");
const { pool } = require("./db");
const {
  requirePasswordChangeComplete,
  requireRole,
  requireUser,
} = require("./auth");

const router = express.Router();
const deviceTypes = new Set(["PC", "Printer"]);
const deviceStatuses = new Set(["Active", "Retired"]);
const maintenanceStatuses = new Set(["Overdue", "Due soon", "Postponed", "On schedule"]);
const intervalUnits = { day: "DAY", week: "WEEK", month: "MONTH" };
const ticketNumberPattern = /^IT-\d{4,}$/i;

router.use(requireUser, requirePasswordChangeComplete, requireRole("technician", "admin"));

function optionalText(value, maxLength) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.trim().length > maxLength) return undefined;
  return value.trim() || null;
}

function parseChecklist(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function planResponse(plan) {
  return {
    id: plan.id,
    name: plan.name,
    deviceType: plan.device_type,
    intervalValue: plan.interval_value,
    intervalUnit: plan.interval_unit,
    checklist: parseChecklist(plan.checklist),
    deviceCount: plan.device_count === undefined ? undefined : plan.device_count,
  };
}

function getDeviceInput(body) {
  const assetTag = typeof body.assetTag === "string" ? body.assetTag.trim() : "";
  const type = body.type;
  const brand = optionalText(body.brand, 100);
  const model = optionalText(body.model, 100);
  const ram = type === "PC" ? optionalText(body.ram, 80) : null;
  const motherboard = type === "PC" ? optionalText(body.motherboard, 120) : null;
  const printerType = type === "Printer" ? body.printer_type : null;
  const supplyModel = type === "Printer" ? optionalText(body.supply_model, 120) : null;
  const ipAddress = type === "Printer" ? optionalText(body.ip_address, 45) : null;
  const serialNo = optionalText(body.serialNo, 120);
  const location = optionalText(body.location, 150);
  const departmentId = body.departmentId === "" || body.departmentId === null
    ? null
    : Number(body.departmentId);
  const assignedUserId = body.assignedUserId === undefined
    || body.assignedUserId === ""
    || body.assignedUserId === null
    ? null
    : Number(body.assignedUserId);
  const lastServiced = body.lastServiced === undefined
    || body.lastServiced === ""
    || body.lastServiced === null
    ? null
    : body.lastServiced;

  if (!assetTag || assetTag.length > 80 || !deviceTypes.has(type)) {
    return { error: "Enter a unique asset tag and choose PC or Printer." };
  }
  if ([brand, model, ram, motherboard, supplyModel, ipAddress, serialNo, location].includes(undefined)) {
    return { error: "One or more device specifications exceed their maximum length." };
  }
  if (type === "Printer" && !["Laser", "Inkjet or ink tank", "Other"].includes(printerType)) {
    return { error: "Choose a valid printer type." };
  }
  if (type === "Printer" && ipAddress && !/^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/.test(ipAddress)) {
    return { error: "Enter a valid IPv4 address." };
  }
  if (!Number.isInteger(departmentId) || departmentId < 1) {
    return { error: "Choose a department." };
  }
  if (assignedUserId !== null && (!Number.isInteger(assignedUserId) || assignedUserId < 1)) {
    return { error: "Choose a valid employee or leave the device unassigned." };
  }
  if (lastServiced !== null && (typeof lastServiced !== "string"
    || !/^\d{4}-\d{2}-\d{2}$/.test(lastServiced))) {
    return { error: "Enter a valid last serviced date." };
  }
  if (lastServiced !== null) {
    const parsedDate = new Date(`${lastServiced}T00:00:00Z`);
    if (Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== lastServiced) {
      return { error: "Enter a valid last serviced date." };
    }
  }
  return {
    value: {
      assetTag,
      type,
      brand,
      model,
      ram,
      motherboard,
      printerType: printerType || null,
      supplyModel,
      ipAddress,
      serialNo,
      location,
      departmentId,
      assignedUserId,
      lastServiced,
    },
  };
}

async function getPlan(connection, type, lock = false) {
  const [rows] = await connection.execute(
    `SELECT interval_value, interval_unit
     FROM maintenance_plans
     WHERE device_type = ?${lock ? " FOR UPDATE" : ""}`,
    [type],
  );
  return rows[0] || null;
}

async function calculateNextDue(connection, lastServiced, plan) {
  const unit = intervalUnits[plan.interval_unit];
  if (!unit) throw new Error("Maintenance plan has an unsupported interval unit.");
  const [rows] = await connection.execute(
    `SELECT DATE_FORMAT(
       DATE_ADD(COALESCE(?, CURDATE()), INTERVAL ? ${unit}),
       '%Y-%m-%d'
     ) AS next_due`,
    [lastServiced, plan.interval_value],
  );
  return rows[0].next_due;
}

function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

async function validateDepartment(connection, departmentId) {
  const [rows] = await connection.execute(
    "SELECT id FROM departments WHERE id = ?",
    [departmentId],
  );
  return rows.length > 0;
}

async function validateAssignedEmployee(connection, assignedUserId) {
  if (assignedUserId === null) return true;
  const [rows] = await connection.execute(
    "SELECT id FROM users WHERE id = ? AND role = 'employee' AND active = TRUE",
    [assignedUserId],
  );
  return rows.length > 0;
}

function sendDeviceError(response, error) {
  if (error.code === "ER_DUP_ENTRY") {
    response.status(409).json({ message: "That asset tag is already in use." });
    return;
  }
  throw error;
}

router.get("/lookups", async (_request, response) => {
  const [[departments], [employees], [plans]] = await Promise.all([
    pool.execute("SELECT id, name FROM departments ORDER BY name"),
    pool.execute(
      `SELECT id, full_name, department_id
       FROM users
       WHERE role = 'employee' AND active = TRUE
       ORDER BY full_name`,
    ),
    pool.execute(
      `SELECT id, name, device_type, interval_value, interval_unit, checklist
       FROM maintenance_plans
       ORDER BY device_type`,
    ),
  ]);
  response.json({
    departments,
    employees: employees.map((employee) => ({
      id: employee.id,
      fullName: employee.full_name,
      departmentId: employee.department_id,
    })),
    plans: plans.map(planResponse),
  });
});

router.get("/schedule", async (request, response) => {
  const type = request.query.type || "All";
  const status = request.query.status || "All";
  const departmentId = request.query.departmentId || "All";
  if (type !== "All" && !deviceTypes.has(type)) {
    response.status(400).json({ message: "Choose a valid device type." });
    return;
  }
  if (status !== "All" && !maintenanceStatuses.has(status)) {
    response.status(400).json({ message: "Choose a valid maintenance status." });
    return;
  }
  if (departmentId !== "All" && (!/^\d+$/.test(String(departmentId)) || Number(departmentId) < 1)) {
    response.status(400).json({ message: "Choose a valid department." });
    return;
  }
  const conditions = ["device.status = 'Active'"];
  const values = [];
  if (type !== "All") {
    conditions.push("device.type = ?");
    values.push(type);
  }
  if (departmentId !== "All") {
    conditions.push("device.department_id = ?");
    values.push(Number(departmentId));
  }
  if (status !== "All") values.push(status);
  const [rows] = await pool.execute(
    `SELECT device.id, device.asset_tag, device.type,
            department.name AS department,
            DATE_FORMAT(device.last_serviced, '%Y-%m-%d') AS last_serviced,
            DATE_FORMAT(device.next_due, '%Y-%m-%d') AS next_due,
            DATE_FORMAT(device.postponed_until, '%Y-%m-%d') AS postponed_until,
            device.postpone_reason,
            plan.name AS plan_name, plan.interval_value, plan.interval_unit,
            CASE
              WHEN device.postponed_until IS NOT NULL
                   AND device.postponed_until > CURDATE() THEN 'Postponed'
              WHEN device.next_due < CURDATE() THEN 'Overdue'
              WHEN device.next_due <= DATE_ADD(CURDATE(), INTERVAL 7 DAY) THEN 'Due soon'
              ELSE 'On schedule'
            END AS maintenance_status
     FROM devices device
     LEFT JOIN departments department ON department.id = device.department_id
     LEFT JOIN maintenance_plans plan ON plan.device_type = device.type
     WHERE ${conditions.join(" AND ")}
     ${status !== "All" ? "HAVING maintenance_status = ?" : ""}
     ORDER BY device.next_due, device.asset_tag`,
    values,
  );
  response.json({
    devices: rows.map((device) => ({
      id: device.id,
      assetTag: device.asset_tag,
      type: device.type,
      department: device.department,
      lastServiced: device.last_serviced,
      nextDue: device.next_due,
      postponedUntil: device.postponed_until,
      postponeReason: device.postpone_reason,
      planName: device.plan_name,
      intervalValue: device.interval_value,
      intervalUnit: device.interval_unit,
      maintenanceStatus: device.maintenance_status,
    })),
  });
});

router.get("/:id/checkup", async (request, response) => {
  if (!/^\d+$/.test(request.params.id) || Number(request.params.id) < 1) {
    response.status(400).json({ message: "Enter a valid device." });
    return;
  }
  const [rows] = await pool.execute(
    `SELECT device.id, device.asset_tag, device.type, device.brand, device.model,
            device.serial_no, device.verification, device.status,
            DATE_FORMAT(device.last_serviced, '%Y-%m-%d') AS last_serviced,
            DATE_FORMAT(device.next_due, '%Y-%m-%d') AS next_due,
            plan.name AS plan_name, plan.interval_value, plan.interval_unit, plan.checklist,
            department.name AS department
     FROM devices device
     LEFT JOIN departments department ON department.id = device.department_id
     LEFT JOIN maintenance_plans plan ON plan.device_type = device.type
     WHERE device.id = ?
     LIMIT 1`,
    [Number(request.params.id)],
  );
  if (!rows.length) {
    response.status(404).json({ message: "Device not found." });
    return;
  }
  const device = rows[0];
  if (device.status !== "Active") {
    response.status(409).json({ message: "Retired devices cannot have a checkup recorded." });
    return;
  }
  if (!device.plan_name) {
    response.status(409).json({ message: `The ${device.type} maintenance plan is not configured.` });
    return;
  }
  const afterNextDue = await calculateNextDue(pool, null, {
    interval_value: device.interval_value,
    interval_unit: device.interval_unit,
  });
  response.json({
    device: {
      id: device.id,
      assetTag: device.asset_tag,
      type: device.type,
      brand: device.brand,
      model: device.model,
      serialNo: device.serial_no,
      department: device.department,
      verification: device.verification,
      lastServiced: device.last_serviced,
      nextDue: device.next_due,
      afterNextDue,
      plan: {
        name: device.plan_name,
        intervalValue: device.interval_value,
        intervalUnit: device.interval_unit,
        checklist: parseChecklist(device.checklist),
      },
    },
  });
});

router.post("/:id/checkup", async (request, response) => {
  if (!/^\d+$/.test(request.params.id) || Number(request.params.id) < 1) {
    response.status(400).json({ message: "Enter a valid device." });
    return;
  }
  const body = request.body || {};
  const completedItems = body.completedItems;
  const notes = body.notes === undefined || body.notes === null
    ? ""
    : typeof body.notes === "string"
      ? body.notes.trim()
      : null;
  if (!Array.isArray(completedItems)
    || completedItems.some((item) => typeof item !== "string")
    || notes === null || notes.length > 10000) {
    response.status(400).json({ message: "Enter valid checklist results and notes." });
    return;
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [devices] = await connection.execute(
      `SELECT id, type, status, verification
       FROM devices
       WHERE id = ?
       FOR UPDATE`,
      [Number(request.params.id)],
    );
    if (!devices.length) {
      await connection.rollback();
      response.status(404).json({ message: "Device not found." });
      return;
    }
    if (devices[0].status !== "Active") {
      await connection.rollback();
      response.status(409).json({ message: "Retired devices cannot have a checkup recorded." });
      return;
    }
    const plan = await getPlan(connection, devices[0].type, true);
    if (!plan) {
      await connection.rollback();
      response.status(409).json({ message: `The ${devices[0].type} maintenance plan is not configured.` });
      return;
    }
    const [planRows] = await connection.execute(
      "SELECT checklist FROM maintenance_plans WHERE device_type = ?",
      [devices[0].type],
    );
    const checklist = parseChecklist(planRows[0].checklist);
    if (completedItems.some((item) => !checklist.includes(item))
      || new Set(completedItems).size !== completedItems.length) {
      await connection.rollback();
      response.status(400).json({ message: "Checklist results must match the device maintenance plan." });
      return;
    }
    const nextDue = await calculateNextDue(connection, null, plan);
    await connection.execute(
      `UPDATE devices
       SET last_serviced = CURDATE(), next_due = ?,
           postponed_until = NULL, postpone_reason = NULL,
           verification = CASE
             WHEN verification = 'Needs IT check' THEN 'Verified'
             ELSE verification
           END
       WHERE id = ?`,
      [nextDue, devices[0].id],
    );
    await connection.execute(
      `INSERT INTO maintenance_logs
        (device_id, done_by, checklist_results, notes)
       VALUES (?, ?, ?, ?)`,
      [
        devices[0].id,
        request.user.id,
        JSON.stringify(completedItems),
        notes || null,
      ],
    );
    await connection.commit();
    response.json({ message: "Checkup recorded.", nextDue });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
});

router.post("/:id/postpone", async (request, response) => {
  if (!/^\d+$/.test(request.params.id) || Number(request.params.id) < 1) {
    response.status(400).json({ message: "Enter a valid device." });
    return;
  }
  const body = request.body || {};
  const newDate = body.newDate;
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (!validDate(newDate) || !reason || reason.length > 500) {
    response.status(400).json({ message: "Choose a valid new due date and enter a reason (up to 500 characters)." });
    return;
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [devices] = await connection.execute(
      `SELECT id, status, next_due
       FROM devices
       WHERE id = ?
       FOR UPDATE`,
      [Number(request.params.id)],
    );
    if (!devices.length) {
      await connection.rollback();
      response.status(404).json({ message: "Device not found." });
      return;
    }
    if (devices[0].status !== "Active") {
      await connection.rollback();
      response.status(409).json({ message: "Retired devices cannot be postponed." });
      return;
    }
    const [dateRows] = await connection.execute(
      `SELECT (CAST(? AS DATE) > CURDATE()) AS future_date,
              (CAST(? AS DATE) > CAST(? AS DATE)) AS later_than_due`,
      [newDate, newDate, devices[0].next_due],
    );
    if (!dateRows[0].future_date) {
      await connection.rollback();
      response.status(400).json({ message: "Choose a date later than today." });
      return;
    }
    if (!dateRows[0].later_than_due) {
      await connection.rollback();
      response.status(400).json({ message: "The new date must be later than the current due date." });
      return;
    }
    await connection.execute(
      `UPDATE devices
       SET next_due = ?, postponed_until = ?, postpone_reason = ?
       WHERE id = ?`,
      [newDate, newDate, reason, devices[0].id],
    );
    await connection.commit();
    response.json({ message: "Maintenance postponed.", nextDue: newDate });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
});

router.get("/", async (request, response) => {
  const type = request.query.type || "All";
  const status = request.query.status || "All";
  const departmentId = request.query.departmentId || "All";
  const search = typeof request.query.search === "string"
    ? request.query.search.trim().slice(0, 120)
    : "";
  if (type !== "All" && !deviceTypes.has(type)) {
    response.status(400).json({ message: "Choose a valid device type." });
    return;
  }
  if (status !== "All" && !deviceStatuses.has(status)) {
    response.status(400).json({ message: "Choose a valid device status." });
    return;
  }
  if (departmentId !== "All" && (!/^\d+$/.test(String(departmentId)) || Number(departmentId) < 1)) {
    response.status(400).json({ message: "Choose a valid department." });
    return;
  }
  const conditions = [];
  const values = [];
  if (type !== "All") {
    conditions.push("device.type = ?");
    values.push(type);
  }
  if (status !== "All") {
    conditions.push("device.status = ?");
    values.push(status);
  }
  if (departmentId !== "All") {
    conditions.push("device.department_id = ?");
    values.push(Number(departmentId));
  }
  if (search) {
    const like = `%${search}%`;
    conditions.push(`(
      device.asset_tag LIKE ? OR device.brand LIKE ? OR device.model LIKE ?
      OR device.ram LIKE ? OR device.motherboard LIKE ? OR device.serial_no LIKE ?
      OR device.ip_address LIKE ?
    )`);
    values.push(like, like, like, like, like, like, like);
  }
  const [rows] = await pool.execute(
    `SELECT device.id, device.asset_tag, device.type, device.brand, device.model,
            device.ram, device.motherboard, device.printer_type, device.supply_model,
            device.ip_address, device.serial_no, device.location, device.status,
            device.verification,
            department.name AS department,
            plan.name AS plan_name,
            DATE_FORMAT(device.last_serviced, '%Y-%m-%d') AS last_serviced,
            DATE_FORMAT(device.next_due, '%Y-%m-%d') AS next_due
     FROM devices device
     LEFT JOIN departments department ON department.id = device.department_id
     LEFT JOIN maintenance_plans plan ON plan.device_type = device.type
     ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
     ORDER BY device.asset_tag`,
    values,
  );
  response.json({
    devices: rows.map((device) => ({
      id: device.id,
      assetTag: device.asset_tag,
      type: device.type,
      brand: device.brand,
      model: device.model,
      ram: device.ram,
      motherboard: device.motherboard,
      printerType: device.printer_type,
      supplyModel: device.supply_model,
      ipAddress: device.ip_address,
      serialNo: device.serial_no,
      location: device.location,
      department: device.department,
      status: device.status,
      verification: device.verification,
      planName: device.plan_name,
      lastServiced: device.last_serviced,
      nextDue: device.next_due,
    })),
  });
});

router.post("/", async (request, response) => {
  const parsed = getDeviceInput(request.body || {});
  if (parsed.error) {
    response.status(400).json({ message: parsed.error });
    return;
  }
  const device = parsed.value;
  const ticketNoValue = typeof request.query.ticketNo === "string"
    ? request.query.ticketNo.trim().toUpperCase()
    : "";
  if (ticketNoValue && !ticketNumberPattern.test(ticketNoValue)) {
    response.status(400).json({ message: "Enter a valid ticket number." });
    return;
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    let ticket = null;
    if (ticketNoValue) {
      const [tickets] = await connection.execute(
        "SELECT id, device_id FROM tickets WHERE ticket_no = ? FOR UPDATE",
        [ticketNoValue],
      );
      if (!tickets.length) {
        await connection.rollback();
        response.status(404).json({ message: "Ticket not found." });
        return;
      }
      if (tickets[0].device_id) {
        await connection.rollback();
        response.status(409).json({ message: "This ticket is already linked to a device." });
        return;
      }
      ticket = tickets[0];
    }
    if (!(await validateDepartment(connection, device.departmentId))) {
      await connection.rollback();
      response.status(400).json({ message: "Choose an existing department." });
      return;
    }
    if (!(await validateAssignedEmployee(connection, device.assignedUserId))) {
      await connection.rollback();
      response.status(400).json({ message: "Choose an active employee." });
      return;
    }
    const plan = await getPlan(connection, device.type, true);
    if (!plan) {
      await connection.rollback();
      response.status(409).json({ message: `The ${device.type} maintenance plan is not configured.` });
      return;
    }
    const nextDue = await calculateNextDue(connection, device.lastServiced, plan);
    const [result] = await connection.execute(
      `INSERT INTO devices
        (asset_tag, type, brand, model, ram, motherboard, printer_type,
         supply_model, ip_address, serial_no, department_id, location,
         assigned_user_id, verification, last_serviced, next_due)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Needs IT check', ?, ?)`,
      [
        device.assetTag,
        device.type,
        device.brand,
        device.model,
        device.ram,
        device.motherboard,
        device.printerType,
        device.supplyModel,
        device.ipAddress,
        device.serialNo,
        device.departmentId,
        device.location,
        device.assignedUserId,
        device.lastServiced,
        nextDue,
      ],
    );
    if (ticket) {
      await connection.execute(
        "UPDATE tickets SET device_id = ?, device_text = NULL WHERE id = ?",
        [result.insertId, ticket.id],
      );
      await connection.execute(
        `INSERT INTO ticket_updates (ticket_id, user_id, note, visible_to_requester)
         VALUES (?, ?, ?, FALSE)`,
        [ticket.id, request.user.id, `Added and linked device ${device.assetTag}.`],
      );
    }
    await connection.commit();
    response.status(201).json({
      id: result.insertId,
      assetTag: device.assetTag,
      nextDue,
      linkedTicketNo: ticketNoValue || null,
    });
  } catch (error) {
    await connection.rollback();
    sendDeviceError(response, error);
  } finally {
    connection.release();
  }
});

router.get("/:id", async (request, response) => {
  if (!/^\d+$/.test(request.params.id) || Number(request.params.id) < 1) {
    response.status(400).json({ message: "Enter a valid device." });
    return;
  }
  const [rows] = await pool.execute(
    `SELECT device.id, device.asset_tag, device.type, device.brand, device.model,
            device.ram, device.motherboard, device.printer_type, device.supply_model,
            device.ip_address, device.serial_no, device.department_id,
            department.name AS department, device.location, device.assigned_user_id,
            assigned.full_name AS assigned_to, device.status, device.verification,
            plan.id AS plan_id, plan.name AS plan_name, plan.interval_value,
            plan.interval_unit, plan.checklist,
            DATE_FORMAT(device.last_serviced, '%Y-%m-%d') AS last_serviced,
            DATE_FORMAT(device.next_due, '%Y-%m-%d') AS next_due
     FROM devices device
     LEFT JOIN departments department ON department.id = device.department_id
     LEFT JOIN users assigned ON assigned.id = device.assigned_user_id
     LEFT JOIN maintenance_plans plan ON plan.device_type = device.type
     WHERE device.id = ?
     LIMIT 1`,
    [Number(request.params.id)],
  );
  if (!rows.length) {
    response.status(404).json({ message: "Device not found." });
    return;
  }
  const device = rows[0];
  const [tickets] = await pool.execute(
    `SELECT ticket_no, summary, status,
            DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at
     FROM tickets
     WHERE device_id = ?
     ORDER BY created_at DESC, id DESC`,
    [device.id],
  );
  const [history] = await pool.execute(
    `SELECT log.done_at, log.checklist_results, log.notes, user.full_name AS done_by
     FROM maintenance_logs log
     JOIN users user ON user.id = log.done_by
     WHERE log.device_id = ?
     ORDER BY log.done_at DESC, log.id DESC`,
    [device.id],
  );
  response.json({
    device: {
      id: device.id,
      assetTag: device.asset_tag,
      type: device.type,
      brand: device.brand,
      model: device.model,
      ram: device.ram,
      motherboard: device.motherboard,
      printerType: device.printer_type,
      supplyModel: device.supply_model,
      ipAddress: device.ip_address,
      serialNo: device.serial_no,
      departmentId: device.department_id,
      department: device.department,
      location: device.location,
      assignedUserId: device.assigned_user_id,
      assignedTo: device.assigned_to,
      status: device.status,
      verification: device.verification,
      lastServiced: device.last_serviced,
      nextDue: device.next_due,
      plan: device.plan_id
        ? {
            id: device.plan_id,
            name: device.plan_name,
            intervalValue: device.interval_value,
            intervalUnit: device.interval_unit,
            checklist: parseChecklist(device.checklist),
          }
        : null,
      tickets: tickets.map((ticket) => ({
        ticketNo: ticket.ticket_no,
        summary: ticket.summary,
        status: ticket.status,
        createdAt: ticket.created_at,
      })),
      history: history.map((entry) => ({
        doneAt: entry.done_at,
        doneBy: entry.done_by,
        checklist: parseChecklist(entry.checklist_results),
        notes: entry.notes,
      })),
    },
  });
});

router.patch("/:id", async (request, response) => {
  if (!/^\d+$/.test(request.params.id) || Number(request.params.id) < 1) {
    response.status(400).json({ message: "Enter a valid device." });
    return;
  }
  const parsed = getDeviceInput(request.body || {});
  if (parsed.error) {
    response.status(400).json({ message: parsed.error });
    return;
  }
  const device = parsed.value;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [currentRows] = await connection.execute(
      `SELECT id, type, DATE_FORMAT(last_serviced, '%Y-%m-%d') AS last_serviced
       FROM devices
       WHERE id = ?
       FOR UPDATE`,
      [Number(request.params.id)],
    );
    if (!currentRows.length) {
      await connection.rollback();
      response.status(404).json({ message: "Device not found." });
      return;
    }
    if (!(await validateDepartment(connection, device.departmentId))) {
      await connection.rollback();
      response.status(400).json({ message: "Choose an existing department." });
      return;
    }
    if (!(await validateAssignedEmployee(connection, device.assignedUserId))) {
      await connection.rollback();
      response.status(400).json({ message: "Choose an active employee." });
      return;
    }
    let nextDue = null;
    if (currentRows[0].type !== device.type || currentRows[0].last_serviced !== device.lastServiced) {
      const plan = await getPlan(connection, device.type, true);
      if (!plan) {
        await connection.rollback();
        response.status(409).json({ message: `The ${device.type} maintenance plan is not configured.` });
        return;
      }
      nextDue = await calculateNextDue(connection, device.lastServiced, plan);
    }
    await connection.execute(
      `UPDATE devices
       SET asset_tag = ?, type = ?, brand = ?, model = ?, ram = ?, motherboard = ?,
           printer_type = ?, supply_model = ?, ip_address = ?, serial_no = ?,
           department_id = ?, location = ?, assigned_user_id = ?, last_serviced = ?,
           next_due = COALESCE(?, next_due)
       WHERE id = ?`,
      [
        device.assetTag,
        device.type,
        device.brand,
        device.model,
        device.ram,
        device.motherboard,
        device.printerType,
        device.supplyModel,
        device.ipAddress,
        device.serialNo,
        device.departmentId,
        device.location,
        device.assignedUserId,
        device.lastServiced,
        nextDue,
        Number(request.params.id),
      ],
    );
    await connection.commit();
    response.json({ message: "Device specifications saved." });
  } catch (error) {
    await connection.rollback();
    sendDeviceError(response, error);
  } finally {
    connection.release();
  }
});

router.patch("/:id/verification", async (request, response) => {
  if (!/^\d+$/.test(request.params.id) || Number(request.params.id) < 1
    || request.body?.verification !== "Verified") {
    response.status(400).json({ message: "Choose a valid device verification status." });
    return;
  }
  const [result] = await pool.execute(
    "UPDATE devices SET verification = 'Verified' WHERE id = ? AND verification = 'Needs IT check'",
    [Number(request.params.id)],
  );
  if (!result.affectedRows) {
    response.status(404).json({ message: "Device not found or already verified." });
    return;
  }
  response.json({ message: "Device verified." });
});

module.exports = router;
