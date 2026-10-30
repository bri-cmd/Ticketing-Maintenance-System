const express = require("express");
const { pool } = require("./db");
const { backupNow } = require("./backup");
const {
  requirePasswordChangeComplete,
  requireRole,
  requireUser,
} = require("./auth");

const router = express.Router();
router.use(requireUser, requirePasswordChangeComplete, requireRole("technician", "admin"));

function getReportFilters(request, response) {
  const month = typeof request.query.month === "string" ? request.query.month : "";
  const departmentId = request.query.departmentId || "All";
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    response.status(400).json({ message: "Choose a valid report month." });
    return null;
  }
  if (departmentId !== "All"
    && (!/^\d+$/.test(String(departmentId)) || Number(departmentId) < 1)) {
    response.status(400).json({ message: "Choose a valid department." });
    return null;
  }
  const [year, monthNumber] = month.split("-").map(Number);
  const start = `${month}-01`;
  const next = new Date(Date.UTC(year, monthNumber, 1));
  const end = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-01`;
  return {
    month,
    start,
    end,
    departmentId: departmentId === "All" ? null : Number(departmentId),
  };
}

function csvCell(value) {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function csvResponse(response, filename, headers, rows) {
  const csv = [
    headers.map(csvCell).join(","),
    ...rows.map((row) => row.map(csvCell).join(",")),
  ].join("\r\n");
  response
    .status(200)
    .set("Content-Type", "text/csv; charset=utf-8")
    .set("Content-Disposition", `attachment; filename="${filename}"`)
    .send(`\uFEFF${csv}`);
}

async function getScheduleSummary(departmentId) {
  const [rows] = await pool.execute(
    `SELECT COUNT(*) AS active_devices,
            COALESCE(SUM(
              CASE
                WHEN device.next_due > DATE_ADD(CURDATE(), INTERVAL 7 DAY)
                     AND (device.postponed_until IS NULL OR device.postponed_until <= CURDATE())
                THEN 1 ELSE 0
              END
            ), 0) AS on_schedule
     FROM devices device
     WHERE device.status = 'Active'
       AND (? IS NULL OR device.department_id = ?)`,
    [departmentId, departmentId],
  );
  const active = Number(rows[0].active_devices);
  return {
    activeDevices: active,
    onSchedule: Number(rows[0].on_schedule),
    onSchedulePercent: active ? Math.round((Number(rows[0].on_schedule) / active) * 100) : 0,
  };
}

router.get("/dashboard", async (_request, response) => {
  const [[ticketCounts]] = await pool.query(
    `SELECT
       SUM(status IN ('Open', 'In progress', 'Waiting for parts')) AS open_tickets,
       SUM(
         resolved_at >= DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY)
         AND resolved_at < DATE_ADD(DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY), INTERVAL 7 DAY)
       ) AS resolved_this_week
     FROM tickets`,
  );
  const [[deviceCounts]] = await pool.query(
    `SELECT
       COUNT(*) AS active_devices,
       SUM(
         device.next_due < CURDATE()
         AND (device.postponed_until IS NULL OR device.postponed_until <= CURDATE())
       ) AS overdue,
       SUM(
         device.next_due >= CURDATE()
         AND device.next_due <= DATE_ADD(
           DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY),
           INTERVAL 6 DAY
         )
         AND (device.postponed_until IS NULL OR device.postponed_until <= CURDATE())
       ) AS due_this_week,
       SUM(
         device.next_due > DATE_ADD(CURDATE(), INTERVAL 7 DAY)
         AND (device.postponed_until IS NULL OR device.postponed_until <= CURDATE())
       ) AS on_schedule
     FROM devices device
     WHERE device.status = 'Active'`,
  );
  const [recentRows] = await pool.query(
    `SELECT ticket.ticket_no, ticket.summary, ticket.status, ticket.priority, ticket.source,
            COALESCE(requester.full_name, ticket.guest_name, 'Guest') AS requester_name,
            department.name AS department,
            DATE_FORMAT(ticket.created_at, '%Y-%m-%d %H:%i:%s') AS submitted_at
     FROM tickets ticket
     LEFT JOIN users requester ON requester.id = ticket.requester_user_id
     LEFT JOIN departments department ON department.id = ticket.department_id
     ORDER BY ticket.created_at DESC, ticket.id DESC
     LIMIT 5`,
  );
  const [attentionRows] = await pool.query(
    `SELECT device.id, device.asset_tag, device.type, department.name AS department,
            plan.name AS plan_name, plan.interval_value, plan.interval_unit,
            DATE_FORMAT(device.last_serviced, '%Y-%m-%d') AS last_serviced,
            DATE_FORMAT(device.next_due, '%Y-%m-%d') AS next_due,
            CASE
              WHEN device.next_due < CURDATE() THEN 'Overdue'
              ELSE 'Due soon'
            END AS maintenance_status,
            DATEDIFF(device.next_due, CURDATE()) AS days_to_due
     FROM devices device
     LEFT JOIN departments department ON department.id = device.department_id
     LEFT JOIN maintenance_plans plan ON plan.device_type = device.type
     WHERE device.status = 'Active'
       AND (device.postponed_until IS NULL OR device.postponed_until <= CURDATE())
       AND device.next_due <= DATE_ADD(CURDATE(), INTERVAL 7 DAY)
     ORDER BY device.next_due, device.asset_tag
     LIMIT 5`,
  );
  const active = Number(deviceCounts.active_devices);
  response.json({
    metrics: {
      openTickets: Number(ticketCounts.open_tickets || 0),
      resolvedThisWeek: Number(ticketCounts.resolved_this_week || 0),
      overdueMaintenance: Number(deviceCounts.overdue || 0),
      maintenanceDueThisWeek: Number(deviceCounts.due_this_week || 0),
      onSchedulePercent: active ? Math.round((Number(deviceCounts.on_schedule || 0) / active) * 100) : 0,
    },
    recentTickets: recentRows.map((ticket) => ({
      ticketNo: ticket.ticket_no,
      summary: ticket.summary,
      requesterName: ticket.requester_name,
      department: ticket.department,
      status: ticket.status,
      priority: ticket.priority,
      source: ticket.source,
      submittedAt: ticket.submitted_at,
    })),
    maintenanceAttention: attentionRows.map((device) => ({
      id: device.id,
      assetTag: device.asset_tag,
      type: device.type,
      department: device.department,
      planName: device.plan_name,
      intervalValue: device.interval_value,
      intervalUnit: device.interval_unit,
      lastServiced: device.last_serviced,
      nextDue: device.next_due,
      status: device.maintenance_status,
      daysToDue: Number(device.days_to_due),
    })),
  });
});

router.get("/reports/lookups", async (_request, response) => {
  const [departments] = await pool.query(
    "SELECT id, name FROM departments WHERE active = TRUE ORDER BY sort_order, id",
  );
  response.json({ departments });
});

router.get("/reports", async (request, response) => {
  const filters = getReportFilters(request, response);
  if (!filters) return;
  const ticketConditions = ["ticket.created_at >= ?", "ticket.created_at < ?"];
  const ticketValues = [filters.start, filters.end];
  if (filters.departmentId !== null) {
    ticketConditions.push("ticket.department_id = ?");
    ticketValues.push(filters.departmentId);
  }
  const [[ticketSummary]] = await pool.execute(
    `SELECT SUM(ticket.created_at >= ? AND ticket.created_at < ?) AS received,
            SUM(ticket.resolved_at >= ? AND ticket.resolved_at < ?) AS resolved,
            AVG(
              CASE
                WHEN ticket.resolved_at >= ? AND ticket.resolved_at < ?
                THEN TIMESTAMPDIFF(MINUTE, ticket.created_at, ticket.resolved_at)
                ELSE NULL
              END
            ) AS average_resolution_minutes
     FROM tickets ticket
     WHERE (? IS NULL OR ticket.department_id = ?)
       AND (
         (ticket.created_at >= ? AND ticket.created_at < ?)
         OR (ticket.resolved_at >= ? AND ticket.resolved_at < ?)
       )`,
    [
      filters.start, filters.end,
      filters.start, filters.end,
      filters.start, filters.end,
      filters.departmentId, filters.departmentId,
      filters.start, filters.end,
      filters.start, filters.end,
    ],
  );
  const [departmentRows] = await pool.execute(
    `SELECT COALESCE(department.name, 'Unassigned') AS name, COUNT(*) AS count
     FROM tickets ticket
     LEFT JOIN departments department ON department.id = ticket.department_id
     WHERE ${ticketConditions.join(" AND ")}
     GROUP BY department.name
     ORDER BY count DESC, name`,
    ticketValues,
  );
  const [topicRows] = await pool.execute(
    `SELECT ticket.help_topic AS name, COUNT(*) AS count
     FROM tickets ticket
     WHERE ${ticketConditions.join(" AND ")}
     GROUP BY ticket.help_topic
     ORDER BY count DESC, name`,
    ticketValues,
  );
  const schedule = await getScheduleSummary(filters.departmentId);
  response.json({
    month: filters.month,
    summary: {
      ticketsReceived: Number(ticketSummary.received || 0),
      ticketsResolved: Number(ticketSummary.resolved || 0),
      averageResolutionMinutes: ticketSummary.average_resolution_minutes === null
        ? null
        : Number(ticketSummary.average_resolution_minutes),
      onSchedulePercent: schedule.onSchedulePercent,
    },
    byDepartment: departmentRows.map((row) => ({ name: row.name, count: Number(row.count) })),
    byHelpTopic: topicRows.map((row) => ({ name: row.name, count: Number(row.count) })),
  });
});

router.get("/reports/tickets.csv", requireRole("admin"), async (request, response) => {
  const filters = getReportFilters(request, response);
  if (!filters) return;
  const conditions = ["ticket.created_at >= ?", "ticket.created_at < ?"];
  const values = [filters.start, filters.end];
  if (filters.departmentId !== null) {
    conditions.push("ticket.department_id = ?");
    values.push(filters.departmentId);
  }
  const [rows] = await pool.execute(
    `SELECT ticket.ticket_no, ticket.summary, ticket.details, ticket.help_topic,
            ticket.priority, ticket.source, ticket.status, ticket.guest_email,
            COALESCE(requester.full_name, ticket.guest_name, 'Guest') AS requester_name,
            COALESCE(requester.email, ticket.guest_email) AS requester_email,
            department.name AS department, device.asset_tag AS asset_tag,
            DATE_FORMAT(ticket.created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
            DATE_FORMAT(ticket.resolved_at, '%Y-%m-%d %H:%i:%s') AS resolved_at,
            assigned.full_name AS assigned_to
     FROM tickets ticket
     LEFT JOIN users requester ON requester.id = ticket.requester_user_id
     LEFT JOIN departments department ON department.id = ticket.department_id
     LEFT JOIN devices device ON device.id = ticket.device_id
     LEFT JOIN users assigned ON assigned.id = ticket.assigned_to
     WHERE ${conditions.join(" AND ")}
     ORDER BY ticket.created_at, ticket.id`,
    values,
  );
  csvResponse(response, `tickets-${filters.month}.csv`, [
    "Ticket number", "Requester", "Email", "Department", "Device asset tag",
    "Help topic", "Subject", "Details", "Priority", "Source", "Status",
    "Assigned to", "Submitted at", "Resolved at",
  ], rows.map((row) => [
    row.ticket_no, row.requester_name, row.requester_email, row.department, row.asset_tag,
    row.help_topic, row.summary, row.details, row.priority, row.source, row.status,
    row.assigned_to, row.created_at, row.resolved_at,
  ]));
});

router.get("/reports/maintenance.csv", requireRole("admin"), async (request, response) => {
  const filters = getReportFilters(request, response);
  if (!filters) return;
  const conditions = ["log.done_at >= ?", "log.done_at < ?"];
  const values = [filters.start, filters.end];
  if (filters.departmentId !== null) {
    conditions.push("device.department_id = ?");
    values.push(filters.departmentId);
  }
  const [rows] = await pool.execute(
    `SELECT device.asset_tag, device.type, department.name AS department,
            technician.full_name AS done_by,
            DATE_FORMAT(log.done_at, '%Y-%m-%d %H:%i:%s') AS done_at,
            log.checklist_results, log.notes
     FROM maintenance_logs log
     JOIN devices device ON device.id = log.device_id
     LEFT JOIN departments department ON department.id = device.department_id
     LEFT JOIN users technician ON technician.id = log.done_by
     WHERE ${conditions.join(" AND ")}
     ORDER BY log.done_at, log.id`,
    values,
  );
  csvResponse(response, `maintenance-${filters.month}.csv`, [
    "Asset tag", "Device type", "Department", "Completed by",
    "Completed at", "Checklist results", "Notes",
  ], rows.map((row) => [
    row.asset_tag, row.type, row.department, row.done_by, row.done_at,
    row.checklist_results, row.notes,
  ]));
});

router.post("/backup", requireRole("admin"), async (_request, response) => {
  try {
    const backup = await backupNow();
    response.json({ message: "Database backup completed.", filename: backup.filename, size: backup.size });
  } catch (error) {
    response.status(503).json({ message: error.message });
  }
});

module.exports = router;
