const express = require("express");
const { pool } = require("./db");
const { createTicket } = require("./ticket-creation");
const { parseTicketRequest, resolveTicketDevice, validEmail } = require("./ticket-request");
const { checkPublicSubmissionLimit } = require("./public-submission-limits");
const { requirePasswordChangeComplete, requireUser } = require("./auth");

const router = express.Router();
const validTicketNumber = /^IT-\d{4,}$/i;
const publicStatuses = ["Submitted", "Received", "Assigned", "In repair", "Resolved"];
const helpTopics = new Set([
  "Hardware",
  "Software",
  "Network",
  "Account access",
  "Printer",
  "Other",
]);
const employeePriorities = new Set(["Low", "Normal", "High", "Urgent"]);

function textField(value, maxLength) {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= maxLength
    ? value.trim()
    : null;
}

function statusStep(ticket) {
  if (ticket.status === "Resolved" || ticket.status === "Closed") return "Resolved";
  if (ticket.status === "Waiting for parts") return "In repair";
  if (ticket.status === "In progress") {
    return ticket.assigned_to ? "In repair" : "Received";
  }
  if (ticket.assigned_to) return "Assigned";
  return "Submitted";
}

function publicTicket(ticket) {
  const step = statusStep(ticket);
  return {
    ticketNo: ticket.ticket_no,
    summary: ticket.summary,
    details: ticket.details,
    status: ticket.status,
    progressStatus: step,
    progressIndex: publicStatuses.indexOf(step),
    technician: ticket.technician || "Not assigned yet",
    lastUpdate: ticket.last_update || "Your request has been submitted.",
    lastUpdateAt: ticket.last_update_at,
    messages: ticket.messages || [],
    submittedAt: ticket.created_at,
  };
}

async function getTicketForTracking(connection, condition, values) {
  const [rows] = await connection.execute(
    `SELECT t.id, t.ticket_no, t.summary, t.details, t.status, t.assigned_to,
            DATE_FORMAT(t.created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
            assigned.full_name AS technician,
            (SELECT tu.note
             FROM ticket_updates tu
             WHERE tu.ticket_id = t.id AND tu.visible_to_requester = TRUE
             ORDER BY tu.created_at DESC, tu.id DESC
             LIMIT 1) AS last_update,
            (SELECT DATE_FORMAT(tu.created_at, '%Y-%m-%d %H:%i:%s')
             FROM ticket_updates tu
             WHERE tu.ticket_id = t.id AND tu.visible_to_requester = TRUE
             ORDER BY tu.created_at DESC, tu.id DESC
             LIMIT 1) AS last_update_at
     FROM tickets t
     LEFT JOIN users assigned ON assigned.id = t.assigned_to
     WHERE ${condition}
     LIMIT 1`,
    values,
  );
  if (!rows.length) return null;

  const [updates] = await connection.execute(
    `SELECT note, DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at
     FROM ticket_updates
     WHERE ticket_id = ? AND visible_to_requester = TRUE
     ORDER BY created_at, id`,
    [rows[0].id],
  );
  return publicTicket({
    ...rows[0],
    messages: updates.map((update) => ({
      note: update.note,
      createdAt: update.created_at,
    })),
  });
}

router.get("/departments", async (_request, response) => {
  const [departments] = await pool.execute(
    "SELECT id, name FROM departments WHERE active = TRUE ORDER BY sort_order, id",
  );
  response.json({ departments });
});

router.post("/guest", async (request, response) => {
  const body = request.body || {};
  const parsed = parseTicketRequest(body);
  if (parsed.error) {
    response.status(400).json({ message: parsed.error });
    return;
  }
  const fields = parsed.fields;
  const { email, fullName } = fields;
  const allowedDomains = (process.env.ALLOWED_EMAIL_DOMAINS || "")
    .split(",")
    .map((domain) => domain.trim().toLowerCase().replace(/^@/, ""))
    .filter(Boolean);
  const emailDomain = email.slice(email.lastIndexOf("@") + 1);
  if (allowedDomains.length && !allowedDomains.includes(emailDomain)) {
    response.status(400).json({
      message: `Use an email address from an approved domain: ${allowedDomains.join(", ")}.`,
    });
    return;
  }
  const resolvedDevice = await resolveTicketDevice(pool, fields);
  if (resolvedDevice.error) {
    response.status(400).json({ message: resolvedDevice.error });
    return;
  }

  const limitError = checkPublicSubmissionLimit({ ip: request.ip, email });
  if (limitError) {
    response.status(429).json({ message: limitError });
    return;
  }

  const ticketNo = await createTicket({
    requesterUserId: null,
    guestName: fullName,
    guestEmail: email,
    requesterEmail: email,
    departmentId: fields.departmentId,
    deviceId: resolvedDevice.deviceId,
    deviceText: resolvedDevice.deviceText,
    helpTopic: fields.helpTopic,
    summary: fields.summary,
    details: fields.details,
    priority: "Normal",
    source: "Online",
  });
  response.status(201).json({ ticketNo });
});

router.post("/guest-status", async (request, response) => {
  const body = request.body || {};
  const ticketNo = typeof body.ticketNo === "string"
    ? body.ticketNo.trim().toUpperCase()
    : "";
  const email = typeof body.email === "string"
    ? body.email.trim().toLowerCase()
    : "";
  if (!validTicketNumber.test(ticketNo) || !validEmail.test(email) || email.length > 254) {
    response.status(400).json({ message: "Enter a valid ticket number and email address." });
    return;
  }

  const ticket = await getTicketForTracking(
    pool,
    `t.ticket_no = ? AND LOWER(COALESCE(t.requester_email, t.guest_email)) = ?
     AND t.source IN ('Guest', 'Online', 'Walk-in')`,
    [ticketNo, email],
  );
  if (!ticket) {
    response.status(404).json({ message: "No ticket matched that number and email." });
    return;
  }
  response.json({ ticket });
});

router.get(
  "/employee-options",
  requireUser,
  requirePasswordChangeComplete,
  async (request, response) => {
    if (request.user.role !== "employee") {
      response.status(403).json({ message: "Only employees can create employee requests." });
      return;
    }
    const [computers] = await pool.execute(
      `SELECT id, asset_tag, brand, model
       FROM devices
       WHERE assigned_user_id = ? AND type = 'PC' AND status = 'Active'
       ORDER BY id
       LIMIT 1`,
      [request.user.id],
    );
    const [printers] = await pool.execute(
      `SELECT d.id, d.asset_tag, d.brand, d.model, d.location, dep.name AS department
       FROM devices d
       LEFT JOIN departments dep ON dep.id = d.department_id
       WHERE d.type = 'Printer' AND d.status = 'Active'
       ORDER BY dep.name, d.asset_tag`,
    );
    response.json({
      computer: computers[0] || null,
      printers: printers.map((printer) => ({
        id: printer.id,
        assetTag: printer.asset_tag,
        brand: printer.brand,
        model: printer.model,
        location: printer.location,
        department: printer.department,
      })),
    });
  },
);

router.post(
  "/employee",
  requireUser,
  requirePasswordChangeComplete,
  async (request, response) => {
    if (request.user.role !== "employee") {
      response.status(403).json({ message: "Only employees can create employee requests." });
      return;
    }
    const body = request.body || {};
    const helpTopic = textField(body.helpTopic, 100);
    const summary = textField(body.summary, 200);
    const details = textField(body.details, 10000);
    const priority = body.priority;
    const deviceChoice = body.deviceChoice;
    const otherDevice = typeof body.otherDevice === "string"
      ? body.otherDevice.trim()
      : "";
    if (!helpTopic || !helpTopics.has(helpTopic) || !summary || !details) {
      response.status(400).json({ message: "Choose a help topic and enter an issue summary and details." });
      return;
    }
    if (!employeePriorities.has(priority)) {
      response.status(400).json({ message: "Choose a valid priority." });
      return;
    }
    if (!["computer", "printer", "other"].includes(deviceChoice)) {
      response.status(400).json({ message: "Choose which device needs help." });
      return;
    }
    if (deviceChoice === "other" && (!otherDevice || otherDevice.length > 255)) {
      response.status(400).json({ message: "Describe the other device in 1–255 characters." });
      return;
    }

    let deviceId = null;
    let deviceText = null;
    if (deviceChoice === "computer") {
      const [devices] = await pool.execute(
        `SELECT id FROM devices
         WHERE assigned_user_id = ? AND type = 'PC' AND status = 'Active'
         ORDER BY id LIMIT 1`,
        [request.user.id],
      );
      if (!devices.length) {
        response.status(400).json({ message: "Your computer is not set up yet. Choose Other or set up your computer first." });
        return;
      }
      deviceId = devices[0].id;
    } else if (deviceChoice === "printer") {
      const printerId = Number(body.printerId);
      if (!Number.isInteger(printerId) || printerId < 1) {
        response.status(400).json({ message: "Choose a shared printer." });
        return;
      }
      const [printers] = await pool.execute(
        "SELECT id FROM devices WHERE id = ? AND type = 'Printer' AND status = 'Active'",
        [printerId],
      );
      if (!printers.length) {
        response.status(400).json({ message: "Choose an available shared printer." });
        return;
      }
      deviceId = printers[0].id;
    } else {
      deviceText = otherDevice;
    }

    const ticketNo = await createTicket({
      requesterUserId: request.user.id,
      guestName: null,
      guestEmail: null,
      requesterEmail: request.user.email,
      departmentId: request.user.department_id,
      deviceId,
      deviceText,
      helpTopic,
      summary,
      details,
      priority,
      source: "Signed in",
    });
    response.status(201).json({ ticketNo });
  },
);

router.get(
  "/mine",
  requireUser,
  requirePasswordChangeComplete,
  async (request, response) => {
    if (request.user.role !== "employee") {
      response.status(403).json({ message: "Only employees can view employee requests." });
      return;
    }
    const [tickets] = await pool.execute(
      `SELECT ticket_no, summary, status, assigned_to,
              DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at
       FROM tickets
       WHERE requester_user_id = ?
       ORDER BY created_at DESC, id DESC`,
      [request.user.id],
    );
    response.json({
      tickets: tickets.map((ticket) => ({
        ticketNo: ticket.ticket_no,
        summary: ticket.summary,
        status: ticket.status,
        progressStatus: statusStep(ticket),
        submittedAt: ticket.created_at,
      })),
    });
  },
);

router.get(
  "/mine/:ticketNo",
  requireUser,
  requirePasswordChangeComplete,
  async (request, response) => {
    if (request.user.role !== "employee") {
      response.status(403).json({ message: "Only employees can view employee requests." });
      return;
    }
    const ticketNo = request.params.ticketNo.toUpperCase();
    if (!validTicketNumber.test(ticketNo)) {
      response.status(400).json({ message: "Enter a valid ticket number." });
      return;
    }
    const ticket = await getTicketForTracking(
      pool,
      "t.ticket_no = ? AND t.requester_user_id = ?",
      [ticketNo, request.user.id],
    );
    if (!ticket) {
      response.status(404).json({ message: "Request not found." });
      return;
    }
    response.json({ ticket });
  },
);

module.exports = router;
