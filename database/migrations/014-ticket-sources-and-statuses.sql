USE it_service_desk;

UPDATE tickets
SET source = 'Online'
WHERE source IN ('Guest', 'Signed in');

ALTER TABLE tickets
  MODIFY COLUMN source ENUM('Online', 'Walk-in') NOT NULL;

ALTER TABLE ticket_updates
  MODIFY COLUMN old_status VARCHAR(40) NULL,
  MODIFY COLUMN new_status VARCHAR(40) NULL;

INSERT INTO ticket_updates
  (ticket_id, user_id, note, old_status, new_status, visible_to_requester, created_at)
SELECT id, NULL,
       'Automatically changed status from Waiting for parts to In Progress during status simplification.',
       'Waiting for parts', 'In Progress', FALSE, NOW()
FROM tickets
WHERE status = 'Waiting for parts';

ALTER TABLE tickets
  MODIFY COLUMN status VARCHAR(40) NOT NULL DEFAULT 'Open';

UPDATE tickets
SET status = 'In Progress'
WHERE status IN ('In progress', 'Waiting for parts');

ALTER TABLE tickets
  MODIFY COLUMN status ENUM('Open', 'In Progress', 'Resolved', 'Closed') NOT NULL DEFAULT 'Open';
