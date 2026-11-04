const express = require("express");
const { pool } = require("./db");
const { createTicket } = require("./ticket-creation");
const { parseTicketRequest, resolveTicketDevice } = require("./ticket-request");
const { queueTicketUpdate } = require("./mail-queue");
const {
  requirePasswordChangeComplete,
  requireRole,
  requireUser,
} = require("./auth");

const router = express.Router();
const statuses = new Set(["Open", "In Progress", "Resolved", "Closed"]);
const priorities = new Set(["Low", "Normal", "High", "Urgent"]);
const sources = new Set(["Online", "Walk-in"]);
const ticketNumberPattern = /^(?:IT-\d{4,}|\d{5,6})$/i;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(value) {
  if (typeof value !== "string" || !datePattern.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

router.use(requireUser, requirePasswordChangeComplete, requireRole("technician", "admin"));

router.get("/", async (request, response) => {
  const { status, priority, source, search } = request.query;
  if (status && status !== "All" && (!statuses.has(status) || status === "Closed")) {
    response.status(400).json({ message: "Choose an active ticket status. Closed tickets are in Ticket History." });
    return;
  }
  if (priority && priority !== "All" && !priorities.has(priority)) {
    response.status(400).json({ message: "Choose a valid ticket priority." });
    return;
  }
  if (source && source !== "All" && !sources.has(source)) {
    response.status(400).json({ message: "Choose a valid ticket source." });
    return;
  }
  const term = typeof search === "string" ? search.trim().slice(0, 120) : "";
  const conditions = ["t.status <> 'Closed'"];
  const values = [];
  if (status && status !== "All") {
    conditions.push("t.status = ?");
    values.push(status);
  }
  if (priority && priority !== "All") {
    conditions.push("t.priority = ?");
    values.push(priority);
  }
  if (source && source !== "All") {
    conditions.push("t.source = ?");
    values.push(source);
  }
  if (term) {
    const like = `%${term}%`;
    conditions.push(`(
      t.ticket_no LIKE ? OR t.guest_name LIKE ? OR requester.full_name LIKE ?
      OR d.asset_tag LIKE ? OR t.device_text LIKE ?
      OR d.brand LIKE ? OR d.model LIKE ?
    )`);
    values.push(like, like, like, like, like, like, like);
  }

  const [rows] = await pool.execute(
    `SELECT t.ticket_no, t.summary, t.status, t.priority, t.source,
            COALESCE(requester.full_name, t.guest_name, 'Employee') AS requester_name,
            department.name AS department,
            d.id AS device_id, d.asset_tag, t.device_text,
            DATE_FORMAT(t.created_at, '%Y-%m-%d %H:%i:%s') AS created_at
     FROM tickets t
     LEFT JOIN users requester ON requester.id = t.requester_user_id
     LEFT JOIN departments department ON department.id = t.department_id
     LEFT JOIN devices d ON d.id = t.device_id
     ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
     ORDER BY t.created_at DESC, t.id DESC`,
    values,
  );
  response.json({
    tickets: rows.map((ticket) => ({
      ticketNo: ticket.ticket_no,
      summary: ticket.summary,
      requesterName: ticket.requester_name,
      department: ticket.department,
      deviceId: ticket.device_id,
      deviceTag: ticket.asset_tag,
      deviceText: ticket.device_text,
      notRegistered: !ticket.device_id,
      priority: ticket.priority,
      source: ticket.source,
      status: ticket.status,
      submittedAt: ticket.created_at,
    })),
  });
});

router.get("/history/lookups", async (_request, response) => {
  const [departments] = await pool.query(
    "SELECT id, name FROM departments ORDER BY sort_order, id",
  );
  const [assignees] = await pool.query(
    `SELECT DISTINCT user.id, user.full_name, user.role
     FROM users user
     JOIN tickets ticket ON ticket.assigned_to = user.id
     WHERE ticket.status = 'Closed' AND user.role IN ('admin', 'technician')
     ORDER BY user.full_name`,
  );
  response.json({ departments, assignees });
});

router.get("/history", async (request, response) => {
  const { search, departmentId, assignedTo, from, to } = request.query;
  const term = typeof search === "string" ? search.trim().slice(0, 120) : "";
  if (departmentId && departmentId !== "All"
    && (!/^\d+$/.test(String(departmentId)) || Number(departmentId) < 1)) {
    response.status(400).json({ message: "Choose a valid department." });
    return;
  }
  if (assignedTo && assignedTo !== "All"
    && (!/^\d+$/.test(String(assignedTo)) || Number(assignedTo) < 1)) {
    response.status(400).json({ message: "Choose a valid technician." });
    return;
  }
  if ((from && !isValidDate(String(from))) || (to && !isValidDate(String(to)))) {
    response.status(400).json({ message: "Choose valid dates for the history range." });
    return;
  }
  if (from && to && from > to) {
    response.status(400).json({ message: "The start date must be on or before the end date." });
    return;
  }

  const conditions = ["ticket.status = 'Closed'"];
  const values = [];
  if (term) {
    const like = `%${term}%`;
    conditions.push(`(
      ticket.ticket_no LIKE ? OR ticket.guest_name LIKE ? OR requester.full_name LIKE ?
      OR COALESCE(ticket.requester_email, requester.email, ticket.guest_email) LIKE ?
      OR department.name LIKE ? OR device.asset_tag LIKE ? OR ticket.device_text LIKE ?
      OR device.brand LIKE ? OR device.model LIKE ? OR assigned.full_name LIKE ?
    )`);
    values.push(like, like, like, like, like, like, like, like, like, like);
  }
  if (departmentId && departmentId !== "All") {
    conditions.push("ticket.department_id = ?");
    values.push(Number(departmentId));
  }
  if (assignedTo && assignedTo !== "All") {
    conditions.push("ticket.assigned_to = ?");
    values.push(Number(assignedTo));
  }
  if (from) {
    conditions.push("ticket.closed_at >= ?");
    values.push(from);
  }
  if (to) {
    conditions.push("ticket.closed_at < DATE_ADD(?, INTERVAL 1 DAY)");
    values.push(to);
  }

  const [rows] = await pool.execute(
    `SELECT ticket.ticket_no, ticket.summary, ticket.status, ticket.priority, ticket.source,
            COALESCE(requester.full_name, ticket.guest_name, 'Employee') AS requester_name,
            COALESCE(ticket.requester_email, requester.email, ticket.guest_email) AS requester_email,
            department.name AS department, device.asset_tag, ticket.device_text,
            assigned.full_name AS assigned_name,
            DATE_FORMAT(ticket.created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
            DATE_FORMAT(ticket.closed_at, '%Y-%m-%d %H:%i:%s') AS closed_at,
            (SELECT closer.full_name
             FROM ticket_updates close_update
             LEFT JOIN users closer ON closer.id = close_update.user_id
             WHERE close_update.ticket_id = ticket.id AND close_update.new_status = 'Closed'
             ORDER BY close_update.created_at DESC, close_update.id DESC
             LIMIT 1) AS closed_by
     FROM tickets ticket
     LEFT JOIN users requester ON requester.id = ticket.requester_user_id
     LEFT JOIN departments department ON department.id = ticket.department_id
     LEFT JOIN devices device ON device.id = ticket.device_id
     LEFT JOIN users assigned ON assigned.id = ticket.assigned_to
     WHERE ${conditions.join(" AND ")}
     ORDER BY ticket.closed_at DESC, ticket.id DESC`,
    values,
  );
  response.json({
    tickets: rows.map((ticket) => ({
      ticketNo: ticket.ticket_no,
      summary: ticket.summary,
      requesterName: ticket.requester_name,
      requesterEmail: ticket.requester_email,
      department: ticket.department,
      deviceTag: ticket.asset_tag,
      deviceText: ticket.device_text,
      assignedName: ticket.assigned_name,
      priority: ticket.priority,
      source: ticket.source,
      status: ticket.status,
      submittedAt: ticket.created_at,
      closedAt: ticket.closed_at,
      closedBy: ticket.closed_by,
    })),
  });
});

router.get("/lookups", async (request, response) => {
  const term = typeof request.query.query === "string"
    ? request.query.query.trim().slice(0, 100)
    : "";
  const employeeId = typeof request.query.employeeId === "string"
    && /^\d+$/.test(request.query.employeeId)
    ? Number(request.query.employeeId)
    : null;
  const like = `%${term}%`;
  const [[employees], [devices], [assignees], [employeeComputers], [printers]] = await Promise.all([
    pool.execute(
      `SELECT employee.id, employee.full_name, employee.username, employee.email,
              employee.department_id, department.name AS department
       FROM users employee
       LEFT JOIN departments department ON department.id = employee.department_id
       WHERE employee.role = 'employee' AND employee.active = TRUE
         AND (? = '' OR employee.full_name LIKE ? OR employee.username LIKE ? OR employee.email LIKE ?)
       ORDER BY employee.full_name
       LIMIT 20`,
      [term, like, like, like],
    ),
    pool.execute(
      `SELECT d.id, d.asset_tag, d.type, d.brand, d.model, d.department_id,
              department.name AS department
       FROM devices d
       LEFT JOIN departments department ON department.id = d.department_id
       WHERE d.status = 'Active'
         AND (? = '' OR d.asset_tag LIKE ? OR d.brand LIKE ? OR d.model LIKE ?)
       ORDER BY d.asset_tag
       LIMIT 30`,
      [term, like, like, like],
    ),
    pool.execute(
      `SELECT id, full_name, role
       FROM users
       WHERE role IN ('admin', 'technician') AND active = TRUE
       ORDER BY full_name`,
    ),
    employeeId === null
      ? Promise.resolve([[]])
      : pool.execute(
        `SELECT id, asset_tag, type, brand, model
         FROM devices
         WHERE assigned_user_id = ? AND type = 'PC' AND status = 'Active'
         ORDER BY id
         LIMIT 1`,
        [employeeId],
      ),
    pool.execute(
      `SELECT device.id, device.asset_tag, device.type, device.brand, device.model,
              device.department_id, department.name AS department, device.location
       FROM devices device
       LEFT JOIN departments department ON department.id = device.department_id
       WHERE device.type = 'Printer' AND device.status = 'Active'
       ORDER BY device.asset_tag`,
    ),
  ]);
  response.json({
    employees: employees.map((employee) => ({
      id: employee.id,
      fullName: employee.full_name,
      username: employee.username,
      email: employee.email,
      departmentId: employee.department_id,
      department: employee.department,
    })),
    devices: devices.map((device) => ({
      id: device.id,
      assetTag: device.asset_tag,
      type: device.type,
      brand: device.brand,
      model: device.model,
      departmentId: device.department_id,
      department: device.department,
    })),
    assignees: assignees.map((assignee) => ({
      id: assignee.id,
      fullName: assignee.full_name,
      role: assignee.role,
    })),
    employeeComputer: employeeComputers[0] ? {
      id: employeeComputers[0].id,
      assetTag: employeeComputers[0].asset_tag,
      type: employeeComputers[0].type,
      brand: employeeComputers[0].brand,
      model: employeeComputers[0].model,
    } : null,
    printers: printers.map((printer) => ({
      id: printer.id,
      assetTag: printer.asset_tag,
      type: printer.type,
      brand: printer.brand,
      model: printer.model,
      departmentId: printer.department_id,
      department: printer.department,
      location: printer.location,
    })),
  });
});

router.get("/:ticketNo", async (request, response) => {
  const ticketNo = request.params.ticketNo.toUpperCase();
  if (!ticketNumberPattern.test(ticketNo)) {
    response.status(400).json({ message: "Enter a valid ticket number." });
    return;
  }
  const [rows] = await pool.execute(
    `SELECT t.id, t.ticket_no, t.guest_name, t.guest_email, t.help_topic,
            t.summary, t.details, t.priority, t.source, t.status, t.device_text,
            DATE_FORMAT(t.created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
            requester.full_name AS requester_name,
            COALESCE(t.requester_email, requester.email) AS requester_email,
            department.name AS department,
            d.id AS device_id, d.asset_tag, d.type AS device_type, d.brand, d.model,
            DATE_FORMAT(d.last_serviced, '%Y-%m-%d') AS last_serviced,
            DATE_FORMAT(d.next_due, '%Y-%m-%d') AS next_due,
            assigned.id AS assigned_to, assigned.full_name AS assigned_name
     FROM tickets t
     LEFT JOIN users requester ON requester.id = t.requester_user_id
     LEFT JOIN departments department ON department.id = t.department_id
     LEFT JOIN devices d ON d.id = t.device_id
     LEFT JOIN users assigned ON assigned.id = t.assigned_to
     WHERE t.ticket_no = ?
     LIMIT 1`,
    [ticketNo],
  );
  if (!rows.length) {
    response.status(404).json({ message: "Ticket not found." });
    return;
  }
  const [updates] = await pool.execute(
    `SELECT tu.note, tu.old_status, tu.new_status, tu.visible_to_requester,
            DATE_FORMAT(tu.created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
            user.full_name AS author
     FROM ticket_updates tu
     LEFT JOIN users user ON user.id = tu.user_id
     WHERE tu.ticket_id = ?
     ORDER BY tu.created_at, tu.id`,
    [rows[0].id],
  );
  const ticket = rows[0];
  const closeEvent = [...updates].reverse().find((update) => update.new_status === "Closed");
  response.json({
    ticket: {
      id: ticket.id,
      ticketNo: ticket.ticket_no,
      requesterName: ticket.requester_name || ticket.guest_name || "Employee",
      requesterType: "Employee",
      requesterEmail: ticket.requester_email || ticket.guest_email,
      department: ticket.department,
      device: ticket.device_id
        ? {
            id: ticket.device_id,
            assetTag: ticket.asset_tag,
            type: ticket.device_type,
            brand: ticket.brand,
            model: ticket.model,
            lastServiced: ticket.last_serviced,
            nextDue: ticket.next_due,
          }
        : ticket.device_text
          ? { id: null, text: ticket.device_text }
          : null,
      helpTopic: ticket.help_topic,
      summary: ticket.summary,
      details: ticket.details,
      priority: ticket.priority,
      source: ticket.source,
      status: ticket.status,
      assignedTo: ticket.assigned_to,
      assignedName: ticket.assigned_name,
      submittedAt: ticket.created_at,
      closedAt: closeEvent?.created_at || null,
      closedBy: closeEvent?.author || null,
      history: updates.map((update) => ({
        note: update.note,
        oldStatus: update.old_status,
        newStatus: update.new_status,
        visibleToRequester: Boolean(update.visible_to_requester),
        createdAt: update.created_at,
        author: update.author || "System",
      })),
    },
  });
});

router.patch("/:ticketNo", async (request, response) => {
  const ticketNo = request.params.ticketNo.toUpperCase();
  const body = request.body || {};
  const status = body.status;
  const note = typeof body.note === "string" ? body.note.trim() : "";
  const visibleToRequester = body.visibleToRequester === true;
  const assignedTo = body.assignedTo === "" || body.assignedTo === null
    || body.assignedTo === undefined
    ? null
    : Number(body.assignedTo);

  if (!ticketNumberPattern.test(ticketNo)) {
    response.status(400).json({ message: "Enter a valid ticket number." });
    return;
  }
  if (!statuses.has(status)) {
    response.status(400).json({ message: "Choose a valid ticket status." });
    return;
  }
  if (note.length > 5000) {
    response.status(400).json({ message: "Notes must be 5,000 characters or fewer." });
    return;
  }
  if (visibleToRequester && !note) {
    response.status(400).json({ message: "Enter a note before showing it to the employee." });
    return;
  }
  if (assignedTo !== null && (!Number.isInteger(assignedTo) || assignedTo < 1)) {
    response.status(400).json({ message: "Choose valid IT staff or leave the ticket unassigned." });
    return;
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [tickets] = await connection.execute(
      `SELECT ticket.id, ticket.ticket_no, ticket.requester_user_id, ticket.status,
              ticket.assigned_to, assigned.full_name AS assigned_name,
              COALESCE(ticket.requester_email, ticket.guest_email, requester.email) AS requester_email
       FROM tickets ticket
       LEFT JOIN users requester ON requester.id = ticket.requester_user_id
       LEFT JOIN users assigned ON assigned.id = ticket.assigned_to
       WHERE ticket.ticket_no = ? FOR UPDATE`,
      [ticketNo],
    );
    if (!tickets.length) {
      await connection.rollback();
      response.status(404).json({ message: "Ticket not found." });
      return;
    }
    const current = tickets[0];
    if (current.status === "Closed") {
      await connection.rollback();
      response.status(409).json({ message: "Closed tickets cannot be edited. An admin must reopen the ticket first." });
      return;
    }
    if (status === "Closed" && current.status !== "Resolved") {
      await connection.rollback();
      response.status(400).json({ message: "Only resolved tickets can be closed." });
      return;
    }
    const statusChanged = current.status !== status;
    const assignmentChanged = Number(current.assigned_to) !== assignedTo
      && !(current.assigned_to === null && assignedTo === null);
    if (assignmentChanged && assignedTo !== null) {
      const [assignees] = await connection.execute(
        "SELECT id FROM users WHERE id = ? AND role IN ('admin', 'technician') AND active = TRUE",
        [assignedTo],
      );
      if (!assignees.length) {
        await connection.rollback();
        response.status(400).json({ message: "Choose active IT staff or an admin." });
        return;
      }
    }
    let assignedName = null;
    const auditParts = [];
    if (statusChanged) auditParts.push(`Status changed from ${current.status} to ${status}.`);
    if (assignmentChanged) {
      if (assignedTo === null) {
        auditParts.push(current.assigned_name
          ? `Technician ${current.assigned_name} was unassigned.`
          : "Ticket unassigned.");
      } else {
        const [assignees] = await connection.execute(
          "SELECT full_name FROM users WHERE id = ?",
          [assignedTo],
        );
        assignedName = assignees[0].full_name;
        auditParts.push(current.assigned_name
          ? `Technician changed from ${current.assigned_name} to ${assignedName}.`
          : `Assigned to ${assignedName}.`);
      }
    }
    if (assignedTo !== null && assignedName === null) {
      const [assignees] = await connection.execute(
        "SELECT full_name FROM users WHERE id = ?",
        [assignedTo],
      );
      assignedName = assignees[0]?.full_name || null;
    }
    if (!auditParts.length) {
      if (!note) {
        await connection.rollback();
        response.status(400).json({ message: "Change the status or assignee, or add a note." });
        return;
      }
    }

    await connection.execute(
      `UPDATE tickets
       SET status = ?, assigned_to = ?,
           resolved_at = CASE
             WHEN ? = 'Resolved' THEN COALESCE(resolved_at, NOW())
             WHEN ? = 'Closed' THEN resolved_at
             ELSE NULL
           END,
           closed_at = CASE
             WHEN ? = 'Closed' THEN COALESCE(closed_at, NOW())
             ELSE NULL
           END
       WHERE id = ?`,
      [status, assignedTo, status, status, status, current.id],
    );
    if (auditParts.length) {
      await connection.execute(
        `INSERT INTO ticket_updates
          (ticket_id, user_id, note, old_status, new_status, visible_to_requester)
         VALUES (?, ?, ?, ?, ?, FALSE)`,
        [
          current.id,
          request.user.id,
          auditParts.join(" "),
          statusChanged ? current.status : null,
          statusChanged ? status : null,
        ],
      );
    }
    if (note) {
      await connection.execute(
        `INSERT INTO ticket_updates
          (ticket_id, user_id, note, visible_to_requester)
         VALUES (?, ?, ?, ?)`,
        [current.id, request.user.id, note, visibleToRequester],
      );
    }
    if (current.requester_user_id !== null
      && (statusChanged || assignmentChanged || (note && visibleToRequester))) {
      const requesterMessages = [];
      if (statusChanged) requesterMessages.push(`Status is now ${status}.`);
      if (assignmentChanged) {
        requesterMessages.push(assignedTo === null
          ? "The ticket is no longer assigned."
          : "The ticket has been assigned to IT staff.");
      }
      if (note && visibleToRequester) requesterMessages.push("IT added a message.");
      await connection.execute(
        `INSERT INTO notifications (user_id, ticket_id, actor_user_id, title, message)
         VALUES (?, ?, ?, 'Ticket updated', ?)`,
        [
          current.requester_user_id,
          current.id,
          request.user.id,
          `${current.ticket_no}: ${requesterMessages.join(" ")}`,
        ],
      );
    }
    await connection.commit();
    if (statusChanged || assignmentChanged || (note && visibleToRequester)) {
      await queueTicketUpdate({
        ticketId: current.id,
        email: current.requester_email,
        status,
        assignedName,
        statusChanged,
        assignmentChanged,
        closedBy: statusChanged && status === "Closed" ? request.user.full_name : null,
        visibleNote: visibleToRequester ? note : null,
      });
    }
    response.json({ message: "Ticket updated." });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
});

router.post("/:ticketNo/reopen", requireRole("admin"), async (request, response) => {
  const ticketNo = request.params.ticketNo.toUpperCase();
  const reason = typeof request.body?.reason === "string" ? request.body.reason.trim() : "";
  if (!ticketNumberPattern.test(ticketNo)) {
    response.status(400).json({ message: "Enter a valid ticket number." });
    return;
  }
  if (reason.length < 5 || reason.length > 1000) {
    response.status(400).json({ message: "Enter a reopening reason between 5 and 1,000 characters." });
    return;
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [tickets] = await connection.execute(
      `SELECT ticket.id, ticket.ticket_no, ticket.requester_user_id, ticket.status,
              ticket.assigned_to, assigned.full_name AS assigned_name,
              COALESCE(ticket.requester_email, ticket.guest_email, requester.email) AS requester_email
       FROM tickets ticket
       LEFT JOIN users requester ON requester.id = ticket.requester_user_id
       LEFT JOIN users assigned ON assigned.id = ticket.assigned_to
       WHERE ticket.ticket_no = ? FOR UPDATE`,
      [ticketNo],
    );
    if (!tickets.length) {
      await connection.rollback();
      response.status(404).json({ message: "Ticket not found." });
      return;
    }
    const current = tickets[0];
    if (current.status !== "Closed") {
      await connection.rollback();
      response.status(409).json({ message: "Only closed tickets can be reopened." });
      return;
    }

    await connection.execute(
      "UPDATE tickets SET status = 'Open', resolved_at = NULL, closed_at = NULL WHERE id = ?",
      [current.id],
    );
    await connection.execute(
      `INSERT INTO ticket_updates
        (ticket_id, user_id, note, old_status, new_status, visible_to_requester)
       VALUES (?, ?, ?, 'Closed', 'Open', FALSE)`,
      [current.id, request.user.id, `Ticket reopened. Reason: ${reason}`],
    );
    if (current.requester_user_id !== null) {
      await connection.execute(
        `INSERT INTO notifications (user_id, ticket_id, actor_user_id, title, message)
         VALUES (?, ?, ?, 'Ticket reopened', ?)`,
        [current.requester_user_id, current.id, request.user.id, `${current.ticket_no}: Ticket reopened.`],
      );
    }
    await connection.commit();
    await queueTicketUpdate({
      ticketId: current.id,
      email: current.requester_email,
      status: "Open",
      assignedName: current.assigned_name,
      statusChanged: true,
    });
    response.json({ message: "Ticket reopened and recorded." });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
});

router.post("/:ticketNo/link-device", async (request, response) => {
  const ticketNo = request.params.ticketNo.toUpperCase();
  const body = request.body || {};
  const assetTag = typeof body.assetTag === "string" ? body.assetTag.trim() : "";
  if (!ticketNumberPattern.test(ticketNo) || !assetTag || assetTag.length > 80) {
    response.status(400).json({ message: "Enter a valid ticket number and asset tag." });
    return;
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [tickets] = await connection.execute(
      "SELECT id, device_id, status FROM tickets WHERE ticket_no = ? FOR UPDATE",
      [ticketNo],
    );
    if (!tickets.length) {
      await connection.rollback();
      response.status(404).json({ message: "Ticket not found." });
      return;
    }
    if (tickets[0].status === "Closed") {
      await connection.rollback();
      response.status(409).json({ message: "Closed tickets cannot be edited. An admin must reopen the ticket first." });
      return;
    }
    if (tickets[0].device_id) {
      await connection.rollback();
      response.status(409).json({ message: "This ticket is already linked to a device." });
      return;
    }
    const [devices] = await connection.execute(
      `SELECT id, asset_tag
       FROM devices
       WHERE LOWER(asset_tag) = LOWER(?) AND status = 'Active'
       LIMIT 1`,
      [assetTag],
    );
    if (!devices.length) {
      await connection.rollback();
      response.status(404).json({ message: "No active device matches that asset tag." });
      return;
    }
    await connection.execute(
      "UPDATE tickets SET device_id = ?, device_text = NULL WHERE id = ?",
      [devices[0].id, tickets[0].id],
    );
    await connection.execute(
      `INSERT INTO ticket_updates
        (ticket_id, user_id, note, visible_to_requester)
       VALUES (?, ?, ?, FALSE)`,
      [
        tickets[0].id,
        request.user.id,
        `Linked device ${devices[0].asset_tag} to this ticket.`,
      ],
    );
    await connection.commit();
    response.json({ message: `Linked device ${devices[0].asset_tag}.` });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
});

router.post("/walk-in", async (request, response) => {
  const body = request.body || {};
  const parsed = parseTicketRequest(body);
  if (parsed.error) {
    response.status(400).json({ message: parsed.error });
    return;
  }
  const priority = body.priority || "Normal";
  if (!priorities.has(priority)) {
    response.status(400).json({ message: "Choose a valid ticket priority." });
    return;
  }
  const assignedTo = body.assignedTo === undefined
    ? Number(request.user.id)
    : body.assignedTo === "" || body.assignedTo === null
      ? null
      : Number(body.assignedTo);
  if (assignedTo !== null && (!Number.isInteger(assignedTo) || assignedTo < 1)) {
    response.status(400).json({ message: "Choose an active admin or technician to assign this ticket to." });
    return;
  }
  if (assignedTo !== null) {
    const [assignees] = await pool.execute(
      `SELECT id
       FROM users
       WHERE id = ? AND role IN ('admin', 'technician') AND active = TRUE`,
      [assignedTo],
    );
    if (!assignees.length) {
      response.status(400).json({ message: "Choose an active admin or technician to assign this ticket to." });
      return;
    }
  }
  const fields = parsed.fields;
  const resolvedDevice = await resolveTicketDevice(pool, fields);
  if (resolvedDevice.error) {
    response.status(400).json({ message: resolvedDevice.error });
    return;
  }

  const ticketNo = await createTicket({
    requesterUserId: null,
    guestName: fields.fullName,
    guestEmail: fields.email,
    requesterEmail: fields.email,
    departmentId: fields.departmentId,
    deviceId: resolvedDevice.deviceId,
    deviceText: resolvedDevice.deviceText,
    helpTopic: fields.helpTopic,
    summary: fields.summary,
    details: fields.details,
    priority,
    source: "Walk-in",
    assignedTo,
    createdByUserId: request.user.id,
    actorUserId: request.user.id,
    initialNote: `Walk-in ticket created for ${fields.fullName}.`,
    initialNoteVisible: true,
  });
  response.status(201).json({ ticketNo });
});

module.exports = router;
