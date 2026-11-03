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
         has_status_change, visible_notes, available_at)
       VALUES (
         ?, 'update', ?, ?, ?, ?, IF(? IS NULL, JSON_ARRAY(), JSON_ARRAY(?)),
         DATE_ADD(NOW(), INTERVAL 60 SECOND)
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
         available_at = DATE_ADD(NOW(), INTERVAL 60 SECOND),
         revision = revision + 1`,
      [
        ticket.ticketId,
        ticket.email,
        ticket.status,
        ticket.assignedName,
        Boolean(ticket.statusChanged),
        ticket.visibleNote || null,
        ticket.visibleNote || null,
        ticket.visibleNote || null,
        ticket.visibleNote || null,
      ],
    );
  } catch (error) {
    console.error(`Unable to queue ticket update email: ${error.message}`);
  }
}

function readNotes(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error(`Unable to read queued requester-visible notes: ${error.message}`);
    return [];
  }
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
                queue.visible_notes, queue.revision, ticket.ticket_no, ticket.summary,
                COALESCE(ticket.guest_name, requester.full_name) AS requester_name
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
      const type = isReceived
        ? "received"
        : status === "Resolved"
          ? "resolved"
          : queued.has_status_change
            ? "update"
            : "message";
      await deliverMail({
        ticketId: queued.ticket_id,
        to: queued.to_email,
        type,
        ticket: {
          ticketNo: queued.ticket_no,
          summary: queued.summary,
          requesterName: queued.requester_name,
          status,
          assignedName: queued.assigned_name,
        },
        notes: readNotes(queued.visible_notes),
      });
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
  }, 3000);
  workerTimer.unref();
  processReadyMail().catch((error) => {
    console.error(`Mail queue worker failed: ${error.message}`);
  });
}

module.exports = {
  queueTicketReceived,
  queueTicketUpdate,
  startMailQueue,
};
