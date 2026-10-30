const express = require("express");
const { pool } = require("./db");
const { notifyTicketCreated } = require("./ticket-notifications");
const {
  requirePasswordChangeComplete,
  requireRole,
  requireUser,
} = require("./auth");

const router = express.Router();
const statuses = new Set(["Open", "In progress", "Waiting for parts", "Resolved", "Closed"]);
const priorities = new Set(["Low", "Normal", "High", "Urgent"]);
const sources = new Set(["Guest", "Signed in", "Walk-in"]);
const ticketNumberPattern = /^IT-\d{4,}$/i;

router.use(requireUser, requirePasswordChangeComplete, requireRole("technician", "admin"));

router.get("/", async (request, response) => {
  const { status, priority, source, search } = request.query;
  if (status && status !== "All" && !statuses.has(status)) {
    response.status(400).json({ message: "Choose a valid ticket status." });
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
  const conditions = [];
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
            COALESCE(requester.full_name, t.guest_name, 'Guest') AS requester_name,
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
            requester.full_name AS requester_name, requester.email AS requester_email,
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
  response.json({
    ticket: {
      id: ticket.id,
      ticketNo: ticket.ticket_no,
      requesterName: ticket.requester_name || ticket.guest_name || "Guest",
      requesterType: ticket.requester_name ? "Employee" : "Guest",
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
      "SELECT id, ticket_no, requester_user_id, status, assigned_to FROM tickets WHERE ticket_no = ? FOR UPDATE",
      [ticketNo],
    );
    if (!tickets.length) {
      await connection.rollback();
      response.status(404).json({ message: "Ticket not found." });
      return;
    }
    if (assignedTo !== null) {
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

    const current = tickets[0];
    const statusChanged = current.status !== status;
    const assignmentChanged = Number(current.assigned_to) !== assignedTo
      && !(current.assigned_to === null && assignedTo === null);
    const auditParts = [];
    if (statusChanged) auditParts.push(`Status changed from ${current.status} to ${status}.`);
    if (assignmentChanged) {
      if (assignedTo === null) {
        auditParts.push("Ticket unassigned.");
      } else {
        const [assignees] = await connection.execute(
          "SELECT full_name FROM users WHERE id = ?",
          [assignedTo],
        );
        auditParts.push(`Assigned to ${assignees[0].full_name}.`);
      }
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
             ELSE NULL
           END,
           closed_at = CASE
             WHEN ? = 'Closed' THEN COALESCE(closed_at, NOW())
             ELSE NULL
           END
       WHERE id = ?`,
      [status, assignedTo, status, status, current.id],
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
    response.json({ message: "Ticket updated." });
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
      "SELECT id, device_id FROM tickets WHERE ticket_no = ? FOR UPDATE",
      [ticketNo],
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
  const fullName = typeof body.guestName === "string" ? body.guestName.trim() : "";
  const requesterUserId = body.requesterUserId === "" || body.requesterUserId === null
    || body.requesterUserId === undefined
    ? null
    : Number(body.requesterUserId);
  const guestEmail = typeof body.guestEmail === "string" ? body.guestEmail.trim().toLowerCase() : "";
  const guestDeviceText = typeof body.deviceText === "string" ? body.deviceText.trim() : "";
  const departmentIdInput = body.departmentId === "" || body.departmentId === null
    || body.departmentId === undefined
    ? null
    : Number(body.departmentId);
  const assignedTo = body.assignedTo === "" || body.assignedTo === null
    || body.assignedTo === undefined
    ? null
    : Number(body.assignedTo);
  const deviceChoice = body.deviceChoice;
  const otherDevice = typeof body.otherDevice === "string" ? body.otherDevice.trim() : "";
  const printerId = Number(body.printerId);
  const helpTopic = typeof body.helpTopic === "string" ? body.helpTopic.trim() : "";
  const summary = typeof body.summary === "string" ? body.summary.trim() : "";
  const details = typeof body.details === "string" ? body.details.trim() : "";
  const priority = body.priority;

  if ((requesterUserId === null
      && (!fullName || fullName.length > 150
        || (guestEmail && (guestEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guestEmail)))))
    || (requesterUserId !== null && (!Number.isInteger(requesterUserId) || requesterUserId < 1))) {
    response.status(400).json({ message: "Enter a valid guest name and email, or choose an employee." });
    return;
  }
  if (requesterUserId === null
    && (!Number.isInteger(departmentIdInput) || departmentIdInput < 1
      || guestDeviceText.length > 255)) {
    response.status(400).json({ message: "Choose a department and enter a valid device description." });
    return;
  }
  if (assignedTo !== null && (!Number.isInteger(assignedTo) || assignedTo < 1)) {
    response.status(400).json({ message: "Choose an active admin or technician, or leave the ticket unassigned." });
    return;
  }
  if (!helpTopic || helpTopic.length > 100 || !summary || summary.length > 200
    || !details || details.length > 10000 || !priorities.has(priority)) {
    response.status(400).json({ message: "Complete the help topic, problem, and valid priority." });
    return;
  }

  const connection = await pool.getConnection();
  let lockAcquired = false;
  try {
    await connection.beginTransaction();
    let guestName = fullName || null;
    let requesterName = guestName;
    let departmentId = departmentIdInput;
    let deviceId = null;
    let deviceText = null;
    if (requesterUserId !== null) {
      const [employees] = await connection.execute(
        `SELECT full_name, email, department_id
         FROM users
         WHERE id = ? AND role = 'employee' AND active = TRUE`,
        [requesterUserId],
      );
      if (!employees.length) {
        await connection.rollback();
        response.status(400).json({ message: "Choose an active employee." });
        return;
      }
      guestName = null;
      requesterName = employees[0].full_name;
      departmentId = employees[0].department_id;
      if (!["computer", "printer", "other"].includes(deviceChoice)) {
        await connection.rollback();
        response.status(400).json({ message: "Choose what needs help." });
        return;
      }
      if (deviceChoice === "computer") {
        const [computers] = await connection.execute(
          `SELECT id FROM devices
           WHERE assigned_user_id = ? AND type = 'PC' AND status = 'Active'
           ORDER BY id LIMIT 1`,
          [requesterUserId],
        );
        if (!computers.length) {
          await connection.rollback();
          response.status(400).json({ message: "This employee has no active assigned computer." });
          return;
        }
        deviceId = computers[0].id;
      } else if (deviceChoice === "printer") {
        if (!Number.isInteger(printerId) || printerId < 1) {
          await connection.rollback();
          response.status(400).json({ message: "Choose a shared printer." });
          return;
        }
        const [printers] = await connection.execute(
          "SELECT id FROM devices WHERE id = ? AND type = 'Printer' AND status = 'Active'",
          [printerId],
        );
        if (!printers.length) {
          await connection.rollback();
          response.status(400).json({ message: "Choose an active shared printer." });
          return;
        }
        deviceId = printers[0].id;
      } else {
        if (!otherDevice || otherDevice.length > 255) {
          await connection.rollback();
          response.status(400).json({ message: "Describe the device or equipment." });
          return;
        }
        deviceText = otherDevice;
      }
    } else {
      const [departments] = await connection.execute(
        "SELECT id FROM departments WHERE id = ? AND active = TRUE",
        [departmentId],
      );
      if (!departments.length) {
        await connection.rollback();
        response.status(400).json({ message: "Choose an active department." });
        return;
      }
      if (guestDeviceText) {
        const [devices] = await connection.execute(
          "SELECT id FROM devices WHERE LOWER(asset_tag) = LOWER(?) AND status = 'Active' LIMIT 1",
          [guestDeviceText],
        );
        if (devices.length) deviceId = devices[0].id;
        else deviceText = guestDeviceText;
      }
    }

    if (assignedTo !== null) {
      const [assignees] = await connection.execute(
        "SELECT id FROM users WHERE id = ? AND role IN ('admin', 'technician') AND active = TRUE",
        [assignedTo],
      );
      if (!assignees.length) {
        await connection.rollback();
        response.status(400).json({ message: "Choose an active admin or technician." });
        return;
      }
    }

    const [lockRows] = await connection.execute(
      "SELECT GET_LOCK('bmc_ticket_numbering', 10) AS acquired",
    );
    lockAcquired = lockRows[0].acquired === 1;
    if (!lockAcquired) {
      await connection.rollback();
      response.status(503).json({ message: "Ticket numbering is busy. Please try again." });
      return;
    }
    const [numberRows] = await connection.execute(
      `SELECT COALESCE(MAX(CAST(SUBSTRING(ticket_no, 4) AS UNSIGNED)), 0) AS last_number
       FROM tickets
       WHERE ticket_no REGEXP '^IT-[0-9]+$'`,
    );
    const ticketNo = `IT-${String(Number(numberRows[0].last_number) + 1).padStart(4, "0")}`;
    const [insertResult] = await connection.execute(
      `INSERT INTO tickets
        (ticket_no, requester_user_id, guest_name, guest_email, department_id,
         device_id, device_text, help_topic, summary, details, priority, source, assigned_to)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Walk-in', ?)`,
      [
        ticketNo,
        requesterUserId,
        guestName,
        requesterUserId === null ? (guestEmail || null) : null,
        departmentId,
        deviceId,
        deviceText,
        helpTopic,
        summary,
        details,
        priority,
        assignedTo,
      ],
    );
    await connection.execute(
      `INSERT INTO ticket_updates
        (ticket_id, user_id, note, new_status, visible_to_requester)
       VALUES (?, ?, ?, 'Open', ?)`,
      [
        insertResult.insertId,
        request.user.id,
        requesterUserId === null
          ? `Walk-in ticket created for ${guestName}.`
          : "Walk-in ticket created.",
        requesterUserId !== null,
      ],
    );
    await connection.commit();
    await notifyTicketCreated({
      ticketId: insertResult.insertId,
      ticketNo,
      summary,
      source: "Walk-in",
      actorUserId: request.user.id,
      requesterName,
      requesterUserId,
      assignedTo,
    });
    response.status(201).json({ ticketNo });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    try {
      if (lockAcquired) {
        await connection.execute("SELECT RELEASE_LOCK('bmc_ticket_numbering')");
      }
    } finally {
      connection.release();
    }
  }
});

module.exports = router;
