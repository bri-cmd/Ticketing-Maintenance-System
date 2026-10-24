-- Run once as a MySQL administrator against it_service_desk.
-- The application database user intentionally does not have ALTER privileges.
USE it_service_desk;

ALTER TABLE devices
  ADD COLUMN printer_type ENUM('Laser', 'Inkjet or ink tank', 'Other') NULL AFTER motherboard,
  ADD COLUMN supply_model VARCHAR(120) NULL AFTER printer_type,
  ADD COLUMN ip_address VARCHAR(45) NULL AFTER supply_model;

SET SQL_SAFE_UPDATES = 0;

UPDATE devices
SET ram = NULL,
    motherboard = NULL
WHERE type = 'Printer';

SET SQL_SAFE_UPDATES = 1;
