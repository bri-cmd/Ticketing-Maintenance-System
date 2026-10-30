const { pool } = require("./db");

async function insertNotification(query, values, context) {
  try {
    await pool.execute(query, values);
  } catch (error) {
    console.error(`[Ticket notification: ${context}] ${error.message}`);
  }
}

async function notifyTicketCreated({
  ticketId,
  ticketNo,
  summary,
  source,
  actorUserId = null,
  requesterName = null,
  requesterUserId = null,
  assignedTo = null,
}) {
  try {
    const isWalkIn = source === "Walk-in";
    const title = isWalkIn ? "Walk-in Ticket" : "Submitted Ticket";
    const message = `${ticketNo}: ${summary}`;

    await insertNotification(
      `INSERT INTO notifications (user_id, ticket_id, actor_user_id, title, message)
       SELECT recipient.id, ?, ?, ?, ?
       FROM users recipient
       WHERE recipient.role IN ('admin', 'technician')
         AND recipient.active = TRUE
         AND (? IS NULL OR recipient.id <> ?)
         AND (? IS NULL OR recipient.id <> ?)`,
      [
        ticketId,
        actorUserId,
        title,
        message,
        actorUserId,
        actorUserId,
        isWalkIn && assignedTo !== actorUserId ? assignedTo : null,
        isWalkIn && assignedTo !== actorUserId ? assignedTo : null,
      ],
      `${source} recipients for ${ticketNo}`,
    );

    if (isWalkIn && assignedTo !== null && assignedTo !== actorUserId) {
      await insertNotification(
        `INSERT INTO notifications (user_id, ticket_id, actor_user_id, title, message)
         SELECT id, ?, ?, 'Ticket assigned to you', ?
         FROM users
         WHERE id = ? AND role IN ('admin', 'technician') AND active = TRUE`,
        [ticketId, actorUserId, message, assignedTo],
        `walk-in assignee for ${ticketNo}`,
      );
    }

    if (isWalkIn) {
      await insertNotification(
        `INSERT INTO notifications (user_id, ticket_id, actor_user_id, title, message)
         SELECT id, ?, ?, 'Walk-in ticket created', ?
         FROM users
         WHERE id = ? AND role IN ('admin', 'technician') AND active = TRUE`,
        [
          ticketId,
          actorUserId,
          `You created ${ticketNo} for ${requesterName}: ${summary}`,
          actorUserId,
        ],
        `walk-in creator for ${ticketNo}`,
      );
    }

    if (isWalkIn && requesterUserId !== null) {
      await insertNotification(
        `INSERT INTO notifications (user_id, ticket_id, actor_user_id, title, message)
         SELECT id, ?, ?, 'IT created a request for you', ?
         FROM users
         WHERE id = ? AND role = 'employee'`,
        [ticketId, actorUserId, message, requesterUserId],
        `walk-in employee requester for ${ticketNo}`,
      );
    }
  } catch (error) {
    console.error(`[Ticket notification: ${ticketNo}] ${error.message}`);
  }
}

module.exports = { notifyTicketCreated };
