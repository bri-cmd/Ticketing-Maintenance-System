const { pool } = require("./db");
const { deliverMail } = require("./mailer");

let workerTimer;
let workerRunning = false;

async function queueTicketReceived(ticket) {
  if (!ticket.email) return;
  try {
    await pool.execute(
      `INSERT INTO mail_queue
        (ticket_id, queue_type, to_email, latest_status, assigned_name,
         has_status_change, visible_notes, available_at)
       VALUES (?, 'received', ?, 'Open', NULL, FALSE, JSON_ARRAY(), NOW())
       ON DUPLICATE KEY UPDATE
         to_email = VALUES(to_email),
         available_at = NOW(),
         revision = revision + 1`,
      [ticket.ticketId, ticket.email],
    );
  } catch (error) {
    console.error(`Unable to queue ticket receipt email: ${error.message}`);
  }
}

async function queueTicketUpdate(ticket) {
  if (!ticket.email) return;
  try {
    await pool.execute(
      `INSERT INTO mail_queue
        (ticket_id, queue_type, to_email, latest_status, assigned_name,
         has_status_change, visible_notes, update_events, available_at)
       VALUES (
         ?, 'update', ?, ?, ?, ?, IF(? IS NULL, JSON_ARRAY(), JSON_ARRAY(?)),
         JSON_ARRAY(JSON_OBJECT(
           'status', ?, 'statusChanged', ?, 'assignmentChanged', ?, 'assignedName', ?,
           'visibleNote', ?, 'closedBy', ?,
           'closedAt', IF(? = 'Closed', DATE_FORMAT(NOW(), '%Y-%m-%d %H:%i:%s'), NULL)
         )),
         DATE_ADD(NOW(), INTERVAL 5 SECOND)
       )
       ON DUPLICATE KEY UPDATE
         to_email = VALUES(to_email),
         latest_status = VALUES(latest_status),
         assigned_name = VALUES(assigned_name),
         has_status_change = has_status_change OR VALUES(has_status_change),
         visible_notes = IF(
           ? IS NULL,
           visible_notes,
           JSON_ARRAY_APPEND(visible_notes, '$', ?)
         ),
         update_events = JSON_ARRAY_APPEND(
           COALESCE(update_events, JSON_ARRAY()), '$', JSON_OBJECT(
             'status', ?, 'statusChanged', ?, 'assignmentChanged', ?, 'assignedName', ?,
             'visibleNote', ?, 'closedBy', ?,
             'closedAt', IF(? = 'Closed', DATE_FORMAT(NOW(), '%Y-%m-%d %H:%i:%s'), NULL)
           )
         ),
         available_at = DATE_ADD(NOW(), INTERVAL 5 SECOND),
         revision = revision + 1`,
      [
        ticket.ticketId,
        ticket.email,
        ticket.status,
        ticket.assignedName,
        Boolean(ticket.statusChanged),
        ticket.visibleNote || null,
        ticket.visibleNote || null,
        ticket.status,
        Boolean(ticket.statusChanged),
        Boolean(ticket.assignmentChanged),
        ticket.assignedName,
        ticket.visibleNote || null,
        ticket.closedBy || null,
        ticket.status,
        ticket.visibleNote || null,
        ticket.visibleNote || null,
        ticket.status,
        Boolean(ticket.statusChanged),
        Boolean(ticket.assignmentChanged),
        ticket.assignedName,
        ticket.visibleNote || null,
        ticket.closedBy || null,
        ticket.status,
      ],
    );
  } catch (error) {
    console.error(`Unable to queue ticket update email: ${error.message}`);
  }
}

function readJsonArray(value, label) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error(`Unable to read queued ${label}: ${error.message}`);
    return [];
  }
}

function getUpdateDeliveries(events, queued) {
  const deliveries = [];
  let pendingNotes = [];
  let hasPendingUpdate = false;
  let latestStatus = queued.latest_status || "Open";
  let latestAssignedName = queued.assigned_name;

  function addPendingDelivery() {
    if (!hasPendingUpdate) return;
    deliveries.push({
      type: "update",
      status: latestStatus,
      assignedName: latestAssignedName,
      notes: pendingNotes,
    });
    pendingNotes = [];
    hasPendingUpdate = false;
  }

  for (const event of events) {
    const status = event.status || latestStatus;
    const statusChanged = Boolean(event.statusChanged);
    const assignmentChanged = Boolean(event.assignmentChanged);
    const visibleNote = typeof event.visibleNote === "string" ? event.visibleNote : "";
    latestStatus = status;
    if (assignmentChanged || event.assignedName !== undefined) {
      latestAssignedName = event.assignedName;
    }

    if (statusChanged && (status === "Resolved" || status === "Closed")) {
      const notes = pendingNotes.slice();
      if (visibleNote.trim()) notes.push(visibleNote);
      deliveries.push({
        type: status === "Resolved" ? "resolved" : "closed",
        status,
        assignedName: event.assignedName ?? latestAssignedName,
        notes,
        closedBy: event.closedBy || null,
        closedAt: event.closedAt || null,
      });
      pendingNotes = [];
      hasPendingUpdate = false;
      continue;
    }

    if (statusChanged || assignmentChanged || visibleNote.trim()) hasPendingUpdate = true;
    if (visibleNote.trim()) pendingNotes.push(visibleNote);
  }

  addPendingDelivery();
  return deliveries;
}

async function processReadyMail() {
  if (workerRunning) return;
  workerRunning = true;
  let connection;
  let lockAcquired = false;
  try {
    connection = await pool.getConnection();
    const [lockRows] = await connection.execute(
      "SELECT GET_LOCK('bmc_mail_queue_worker', 0) AS acquired",
    );
    lockAcquired = lockRows[0].acquired === 1;
    if (!lockAcquired) return;

    while (true) {
      const [rows] = await connection.execute(
        `SELECT queue.id, queue.ticket_id, queue.queue_type, queue.to_email,
                queue.latest_status, queue.assigned_name, queue.has_status_change,
                queue.visible_notes, queue.update_events, queue.revision,
                ticket.ticket_no, ticket.summary, ticket.source,
                COALESCE(ticket.guest_name, requester.full_name) AS requester_name,
                (SELECT closer.full_name
                 FROM ticket_updates close_update
                 LEFT JOIN users closer ON closer.id = close_update.user_id
                 WHERE close_update.ticket_id = ticket.id
                   AND close_update.new_status = 'Closed'
                 ORDER BY close_update.id DESC LIMIT 1) AS closed_by,
                (SELECT DATE_FORMAT(close_update.created_at, '%Y-%m-%d %H:%i:%s')
                 FROM ticket_updates close_update
                 WHERE close_update.ticket_id = ticket.id
                   AND close_update.new_status = 'Closed'
                  ORDER BY close_update.id DESC LIMIT 1) AS closed_at
         FROM mail_queue queue
         JOIN tickets ticket ON ticket.id = queue.ticket_id
         LEFT JOIN users requester ON requester.id = ticket.requester_user_id
         WHERE queue.available_at <= NOW()
         ORDER BY queue.available_at, queue.id
         LIMIT 1`,
      );
      if (!rows.length) break;

      const queued = rows[0];
      const isReceived = queued.queue_type === "received";
      const status = queued.latest_status || "Open";
      const baseTicket = {
        ticketNo: queued.ticket_no,
        summary: queued.summary,
        source: queued.source,
        requesterName: queued.requester_name,
      };
      if (isReceived) {
        await deliverMail({
          ticketId: queued.ticket_id,
          to: queued.to_email,
          type: "received",
          ticket: { ...baseTicket, status },
        });
      } else {
        const events = readJsonArray(queued.update_events, "ticket update events");
        const deliveries = events.length
          ? getUpdateDeliveries(events, queued)
          : [{
            type: status === "Closed"
              ? "closed"
              : status === "Resolved"
                ? "resolved"
                : queued.has_status_change ? "update" : "message",
            status,
            assignedName: queued.assigned_name,
            notes: readJsonArray(queued.visible_notes, "requester-visible notes"),
            closedBy: queued.closed_by,
            closedAt: queued.closed_at,
          }];
        for (const delivery of deliveries) {
          await deliverMail({
            ticketId: queued.ticket_id,
            to: queued.to_email,
            type: delivery.type,
            ticket: {
              ...baseTicket,
              status: delivery.status,
              assignedName: delivery.assignedName,
              closedBy: delivery.closedBy,
              closedAt: delivery.closedAt,
            },
            notes: delivery.notes,
          });
        }
      }
      await connection.execute(
        "DELETE FROM mail_queue WHERE id = ? AND revision = ?",
        [queued.id, queued.revision],
      );
    }
  } catch (error) {
    console.error(`Mail queue processing failed: ${error.message}`);
  } finally {
    if (lockAcquired) {
      try {
        await connection.execute("SELECT RELEASE_LOCK('bmc_mail_queue_worker')");
      } catch (error) {
        console.error(`Unable to release mail queue lock: ${error.message}`);
      }
    }
    if (connection) connection.release();
    workerRunning = false;
  }
}

function startMailQueue() {
  if (workerTimer) return;
  workerTimer = setInterval(() => {
    processReadyMail().catch((error) => {
      console.error(`Mail queue worker failed: ${error.message}`);
    });
  }, 1000);
  workerTimer.unref();
  processReadyMail().catch((error) => {
    console.error(`Mail queue worker failed: ${error.message}`);
  });
}

module.exports = {
  processReadyMail,
  queueTicketReceived,
  queueTicketUpdate,
  startMailQueue,
};
