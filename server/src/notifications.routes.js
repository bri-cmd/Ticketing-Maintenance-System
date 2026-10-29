const express = require("express");
const { pool } = require("./db");
const { versionedAvatarPath } = require("./avatar-url");
const { requirePasswordChangeComplete, requireUser } = require("./auth");

const router = express.Router();

router.use(requireUser, requirePasswordChangeComplete);

router.get("/", async (request, response) => {
  const unreadOnly = request.query.unread === "true";
  if (request.query.unread !== undefined
    && request.query.unread !== "true"
    && request.query.unread !== "false") {
    response.status(400).json({ message: "Choose a valid notification filter." });
    return;
  }
  const rawLimit = Number(request.query.limit || 10);
  const rawOffset = Number(request.query.offset || 0);
  if (!Number.isInteger(rawLimit) || rawLimit < 1 || rawLimit > 50
    || !Number.isInteger(rawOffset) || rawOffset < 0) {
    response.status(400).json({ message: "Choose a valid notification page." });
    return;
  }
  const [rows] = await pool.execute(
    `SELECT n.id, n.ticket_id, ticket.ticket_no, n.title, n.message, n.is_read,
            DATE_FORMAT(n.created_at, '%Y-%m-%dT%H:%i:%s') AS created_at,
            actor.full_name AS actor_name, actor.avatar_path AS actor_avatar_path,
            DATE_FORMAT(actor.updated_at, '%Y%m%d%H%i%s') AS actor_avatar_version,
            actor_department.name AS actor_department,
            ticket.source AS ticket_source, ticket.guest_name AS guest_name
     FROM notifications n
     LEFT JOIN tickets ticket ON ticket.id = n.ticket_id
     LEFT JOIN users actor ON actor.id = n.actor_user_id
     LEFT JOIN departments actor_department ON actor_department.id = actor.department_id
     WHERE n.user_id = ?
       AND (? = FALSE OR n.is_read = FALSE)
     ORDER BY n.created_at DESC, n.id DESC
     LIMIT ? OFFSET ?`,
    [request.user.id, unreadOnly, rawLimit + 1, rawOffset],
  );
  const [counts] = await pool.execute(
    "SELECT COUNT(*) AS unread_count FROM notifications WHERE user_id = ? AND is_read = FALSE",
    [request.user.id],
  );
  response.json({
    unreadCount: Number(counts[0].unread_count),
    hasMore: rows.length > rawLimit,
    notifications: rows.slice(0, rawLimit).map((notification) => ({
      id: notification.id,
      ticketNo: notification.ticket_no,
      title: notification.title === "New employee ticket"
        ? "Submitted Ticket"
        : notification.title,
      message: notification.message,
      isRead: Boolean(notification.is_read),
      createdAt: notification.created_at,
      actorType: notification.actor_name ? "user"
        : notification.ticket_source === "Guest" && notification.guest_name ? "guest" : "system",
      actorName: notification.actor_name || notification.guest_name || "System",
      actorAvatarPath: versionedAvatarPath(
        notification.actor_avatar_path,
        notification.actor_avatar_version,
      ),
      actorDepartment: notification.actor_department,
    })),
  });
});

router.patch("/read-all", async (request, response) => {
  await pool.execute(
    "UPDATE notifications SET is_read = TRUE WHERE user_id = ? AND is_read = FALSE",
    [request.user.id],
  );
  response.json({ message: "Notifications marked as read." });
});

router.delete("/read", async (request, response) => {
  const [result] = await pool.execute(
    "DELETE FROM notifications WHERE user_id = ? AND is_read = TRUE",
    [request.user.id],
  );
  response.json({ message: "Read notifications cleared.", deletedCount: result.affectedRows });
});

router.patch("/:id/read", async (request, response) => {
  const notificationId = Number(request.params.id);
  if (!Number.isInteger(notificationId) || notificationId < 1) {
    response.status(400).json({ message: "Invalid notification." });
    return;
  }
  const [result] = await pool.execute(
    "UPDATE notifications SET is_read = TRUE WHERE id = ? AND user_id = ?",
    [notificationId, request.user.id],
  );
  if (!result.affectedRows) {
    const [rows] = await pool.execute(
      "SELECT id FROM notifications WHERE id = ? AND user_id = ?",
      [notificationId, request.user.id],
    );
    if (!rows.length) {
      response.status(404).json({ message: "Notification not found." });
      return;
    }
  }
  response.json({ message: "Notification marked as read." });
});

module.exports = router;
