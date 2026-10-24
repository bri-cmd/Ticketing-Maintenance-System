-- Run once as a MySQL administrator against it_service_desk.
-- The application database user intentionally does not have ALTER privileges.
USE it_service_desk;

ALTER TABLE maintenance_plans
  ADD COLUMN name VARCHAR(120) NOT NULL DEFAULT '' AFTER id;

UPDATE maintenance_plans
SET name = CASE device_type
  WHEN 'PC' THEN 'PC check up'
  WHEN 'Printer' THEN 'Printer service'
  ELSE CONCAT(device_type, ' maintenance')
END
WHERE name = '';
