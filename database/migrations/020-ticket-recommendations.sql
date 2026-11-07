USE it_service_desk;

ALTER TABLE ticket_updates
  ADD COLUMN event_type VARCHAR(40) NULL AFTER visible_to_requester;

CREATE TABLE recommendation_types (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(150) NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_recommendation_types_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO recommendation_types (name, active, sort_order) VALUES
  ('Replace RAM', TRUE, 1),
  ('Upgrade RAM', TRUE, 2),
  ('Replace SSD', TRUE, 3),
  ('Replace HDD', TRUE, 4),
  ('Upgrade HDD to SSD', TRUE, 5),
  ('Replace battery', TRUE, 6),
  ('Replace power supply', TRUE, 7),
  ('Replace keyboard or mouse', TRUE, 8),
  ('Replace monitor', TRUE, 9),
  ('Reinstall or reformat operating system', TRUE, 10),
  ('Replace printer toner or ink', TRUE, 11),
  ('Replace printer parts', TRUE, 12),
  ('Replace device (end of life)', TRUE, 13),
  ('Other', TRUE, 14);

CREATE TABLE ticket_recommendations (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  ticket_id INT UNSIGNED NOT NULL,
  type_id INT UNSIGNED NOT NULL,
  note VARCHAR(500) NULL,
  visible_to_requester BOOLEAN NOT NULL DEFAULT TRUE,
  status ENUM('Recommended', 'Done', 'Withdrawn') NOT NULL DEFAULT 'Recommended',
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  completed_at DATETIME NULL,
  PRIMARY KEY (id),
  KEY idx_ticket_recommendations_ticket (ticket_id, created_at, id),
  KEY idx_ticket_recommendations_type (type_id),
  CONSTRAINT fk_ticket_recommendations_ticket FOREIGN KEY (ticket_id)
    REFERENCES tickets (id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_ticket_recommendations_type FOREIGN KEY (type_id)
    REFERENCES recommendation_types (id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_ticket_recommendations_creator FOREIGN KEY (created_by)
    REFERENCES users (id) ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
