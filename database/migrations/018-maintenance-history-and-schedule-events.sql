USE it_service_desk;

ALTER TABLE maintenance_logs
  ADD COLUMN device_name_snapshot VARCHAR(255) NULL AFTER device_id,
  ADD COLUMN asset_tag_snapshot VARCHAR(80) NULL AFTER device_name_snapshot,
  ADD COLUMN device_type_snapshot ENUM('PC', 'Printer') NULL AFTER asset_tag_snapshot,
  ADD COLUMN maintenance_type ENUM('Routine', 'Repair follow-up', 'Inspection', 'Other')
    NOT NULL DEFAULT 'Routine' AFTER device_type_snapshot,
  ADD COLUMN findings TEXT NULL AFTER notes,
  ADD COLUMN actions_performed TEXT NULL AFTER findings,
  ADD COLUMN parts_replaced TEXT NULL AFTER actions_performed,
  ADD COLUMN related_ticket_id INT UNSIGNED NULL AFTER parts_replaced,
  ADD COLUMN next_scheduled DATE NULL AFTER related_ticket_id,
  ADD COLUMN created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER next_scheduled,
  ADD KEY idx_maintenance_logs_related_ticket (related_ticket_id),
  ADD CONSTRAINT fk_maintenance_logs_related_ticket FOREIGN KEY (related_ticket_id)
    REFERENCES tickets (id) ON UPDATE CASCADE ON DELETE SET NULL;

UPDATE maintenance_logs AS log
JOIN devices AS device ON device.id = log.device_id
SET log.device_name_snapshot = COALESCE(
      NULLIF(TRIM(CONCAT_WS(' ', device.brand, device.model)), ''),
      device.asset_tag
    ),
    log.asset_tag_snapshot = device.asset_tag,
    log.device_type_snapshot = device.type
WHERE log.device_name_snapshot IS NULL
   OR log.asset_tag_snapshot IS NULL
   OR log.device_type_snapshot IS NULL;

CREATE TABLE IF NOT EXISTS device_schedule_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  device_id INT UNSIGNED NOT NULL,
  event_type ENUM('Checkup', 'Postponement', 'Schedule change') NOT NULL,
  old_due DATE NULL,
  new_due DATE NOT NULL,
  reason VARCHAR(1000) NOT NULL,
  changed_by INT UNSIGNED NULL,
  changed_by_name VARCHAR(150) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_device_schedule_events_device_date (device_id, created_at, id),
  KEY idx_device_schedule_events_actor (changed_by),
  CONSTRAINT fk_device_schedule_events_device FOREIGN KEY (device_id)
    REFERENCES devices (id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_device_schedule_events_actor FOREIGN KEY (changed_by)
    REFERENCES users (id) ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
