USE it_service_desk;

SET @department_sort_order_exists = (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'departments'
    AND column_name = 'sort_order'
);
SET @department_sort_order_sql = IF(
  @department_sort_order_exists = 0,
  'ALTER TABLE departments ADD COLUMN sort_order SMALLINT UNSIGNED NOT NULL DEFAULT 0',
  'SELECT 1'
);
PREPARE department_sort_order_statement FROM @department_sort_order_sql;
EXECUTE department_sort_order_statement;
DEALLOCATE PREPARE department_sort_order_statement;

SET @department_active_exists = (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'departments'
    AND column_name = 'active'
);
SET @department_active_sql = IF(
  @department_active_exists = 0,
  'ALTER TABLE departments ADD COLUMN active BOOLEAN NOT NULL DEFAULT TRUE',
  'SELECT 1'
);
PREPARE department_active_statement FROM @department_active_sql;
EXECUTE department_active_statement;
DEALLOCATE PREPARE department_active_statement;

SET @hr_department_id = (
  SELECT id FROM departments WHERE name = 'HR' ORDER BY id LIMIT 1
);
SET @hr_admin_department_id = (
  SELECT id FROM departments WHERE name = 'HR/Admin' ORDER BY id LIMIT 1
);

UPDATE users
SET department_id = @hr_department_id
WHERE department_id = @hr_admin_department_id
  AND @hr_department_id IS NOT NULL
  AND @hr_admin_department_id IS NOT NULL
  AND @hr_department_id <> @hr_admin_department_id;

UPDATE devices
SET department_id = @hr_department_id
WHERE department_id = @hr_admin_department_id
  AND @hr_department_id IS NOT NULL
  AND @hr_admin_department_id IS NOT NULL
  AND @hr_department_id <> @hr_admin_department_id;

UPDATE tickets
SET department_id = @hr_department_id
WHERE department_id = @hr_admin_department_id
  AND @hr_department_id IS NOT NULL
  AND @hr_admin_department_id IS NOT NULL
  AND @hr_department_id <> @hr_admin_department_id;

DELETE FROM departments
WHERE id = @hr_admin_department_id
  AND @hr_department_id IS NOT NULL
  AND @hr_admin_department_id IS NOT NULL
  AND @hr_department_id <> @hr_admin_department_id;

UPDATE departments
SET name = 'HR/Admin'
WHERE id = @hr_department_id;

UPDATE departments
SET active = FALSE, sort_order = 0
WHERE name NOT IN (
  'Hospital Systems (HS)', 'IT', 'Accounting', 'HR/Admin',
  'Marketing', 'Training Center', 'Purchasing', 'Warehouse'
);

INSERT INTO departments (name, sort_order, active)
VALUES
  ('Hospital Systems (HS)', 1, TRUE),
  ('IT', 2, TRUE),
  ('Accounting', 3, TRUE),
  ('HR/Admin', 4, TRUE),
  ('Marketing', 5, TRUE),
  ('Training Center', 6, TRUE),
  ('Purchasing', 7, TRUE),
  ('Warehouse', 8, TRUE)
ON DUPLICATE KEY UPDATE
  sort_order = VALUES(sort_order),
  active = TRUE;

UPDATE users
JOIN departments ON departments.name = 'IT'
SET users.department_id = departments.id
WHERE users.role IN ('admin', 'technician');
