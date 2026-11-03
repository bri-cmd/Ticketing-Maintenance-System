USE it_service_desk;

ALTER TABLE tickets
  MODIFY COLUMN source ENUM('Guest', 'Online', 'Signed in', 'Walk-in') NOT NULL;
