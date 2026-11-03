USE it_service_desk;

ALTER TABLE tickets
  ADD COLUMN requester_email VARCHAR(254) NULL AFTER guest_email;

UPDATE tickets AS ticket
LEFT JOIN users AS requester ON requester.id = ticket.requester_user_id
SET ticket.requester_email = COALESCE(ticket.guest_email, requester.email)
WHERE ticket.requester_email IS NULL;

CREATE TABLE IF NOT EXISTS mail_log (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  ticket_id INT UNSIGNED NULL,
  to_email VARCHAR(254) NOT NULL,
  subject VARCHAR(255) NOT NULL,
  status ENUM('sent', 'failed', 'logged') NOT NULL,
  error TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_mail_log_ticket_date (ticket_id, created_at),
  KEY idx_mail_log_status_date (status, created_at),
  CONSTRAINT fk_mail_log_ticket FOREIGN KEY (ticket_id)
    REFERENCES tickets (id) ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mail_queue (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  ticket_id INT UNSIGNED NOT NULL,
  queue_type ENUM('received', 'update') NOT NULL,
  to_email VARCHAR(254) NOT NULL,
  latest_status VARCHAR(40) NULL,
  assigned_name VARCHAR(150) NULL,
  has_status_change BOOLEAN NOT NULL DEFAULT FALSE,
  visible_notes JSON NOT NULL,
  available_at DATETIME NOT NULL,
  revision INT UNSIGNED NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_mail_queue_ticket_type (ticket_id, queue_type),
  KEY idx_mail_queue_ready (available_at, id),
  CONSTRAINT fk_mail_queue_ticket FOREIGN KEY (ticket_id)
    REFERENCES tickets (id) ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
