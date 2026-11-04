const { pool } = require("./db");
const { queueTicketReceived } = require("./mail-queue");
const { notifyTicketCreated } = require("./ticket-notifications");

async function createTicket(ticketData) {
  const connection = await pool.getConnection();
  let lockAcquired = false;
  try {
    const [lockRows] = await connection.execute(
      "SELECT GET_LOCK('bmc_ticket_numbering', 10) AS acquired",
    );
    lockAcquired = lockRows[0].acquired === 1;
    if (!lockAcquired) {
      const error = new Error("Ticket numbering is busy. Please try again.");
      error.statusCode = 503;
      throw error;
    }

    await connection.beginTransaction();
    const [numberRows] = await connection.execute(
      `SELECT COALESCE(MAX(CAST(SUBSTRING_INDEX(ticket_no, '-', -1) AS UNSIGNED)), 0) AS last_number
       FROM tickets
       WHERE ticket_no REGEXP '^(IT-)?[0-9]+$'`,
    );
    const nextNumber = Number(numberRows[0].last_number) + 1;
    if (!Number.isSafeInteger(nextNumber) || nextNumber > 999999) {
      const error = new Error("The six-digit ticket number limit has been reached.");
      error.statusCode = 503;
      throw error;
    }
    const ticketNo = String(nextNumber).padStart(5, "0");
    const [insertResult] = await connection.execute(
      `INSERT INTO tickets
        (ticket_no, requester_user_id, guest_name, guest_email, requester_email, department_id,
         device_id, device_text, help_topic, summary, details, priority, source, assigned_to)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        ticketNo,
        ticketData.requesterUserId,
        ticketData.guestName,
        ticketData.guestEmail,
        ticketData.requesterEmail,
        ticketData.departmentId,
        ticketData.deviceId,
        ticketData.deviceText,
        ticketData.helpTopic,
        ticketData.summary,
        ticketData.details,
        ticketData.priority,
        ticketData.source,
        ticketData.assignedTo ?? null,
      ],
    );
    await connection.execute(
      `INSERT INTO ticket_updates
        (ticket_id, user_id, note, new_status, visible_to_requester)
       VALUES (?, ?, ?, 'Open', ?)`,
      [
        insertResult.insertId,
        ticketData.createdByUserId ?? null,
        ticketData.initialNote || "Your request has been submitted.",
        ticketData.initialNoteVisible ?? true,
      ],
    );
    if (ticketData.assignedTo !== null && ticketData.assignedTo !== undefined) {
      const [assignees] = await connection.execute(
        "SELECT full_name FROM users WHERE id = ?",
        [ticketData.assignedTo],
      );
      if (assignees.length) {
        await connection.execute(
          `INSERT INTO ticket_updates (ticket_id, user_id, note, visible_to_requester)
           VALUES (?, ?, ?, FALSE)`,
          [
            insertResult.insertId,
            ticketData.createdByUserId ?? ticketData.actorUserId ?? null,
            `Assigned to ${assignees[0].full_name} when the ticket was created.`,
          ],
        );
      }
    }
    await connection.commit();
    await queueTicketReceived({
      ticketId: insertResult.insertId,
      email: ticketData.requesterEmail,
    });
    await notifyTicketCreated({
      ticketId: insertResult.insertId,
      ticketNo,
      summary: ticketData.summary,
      source: ticketData.source,
      actorUserId: ticketData.actorUserId ?? ticketData.requesterUserId,
      requesterName: ticketData.guestName,
      requesterUserId: ticketData.requesterUserId,
      assignedTo: ticketData.assignedTo ?? null,
    });
    return ticketNo;
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
}

module.exports = { createTicket };
