USE it_service_desk;

CREATE TABLE IF NOT EXISTS departments (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(100) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_departments_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS users (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  full_name VARCHAR(150) NOT NULL,
  username VARCHAR(80) NOT NULL,
  email VARCHAR(254) NOT NULL,
  department_id INT UNSIGNED NULL,
  role ENUM('employee', 'technician', 'admin') NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  must_change_password BOOLEAN NOT NULL DEFAULT TRUE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  last_sign_in DATETIME NULL,
  session_version INT UNSIGNED NOT NULL DEFAULT 0,
  computer_setup JSON NULL,
  onboarding_completed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_username (username),
  UNIQUE KEY uq_users_email (email),
  KEY idx_users_department (department_id),
  KEY idx_users_role_active (role, active),
  CONSTRAINT fk_users_department FOREIGN KEY (department_id)
    REFERENCES departments (id) ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS maintenance_plans (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(120) NOT NULL,
  device_type ENUM('PC', 'Printer') NOT NULL,
  interval_value SMALLINT UNSIGNED NOT NULL,
  interval_unit ENUM('day', 'week', 'month', 'year') NOT NULL,
  checklist JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_maintenance_plans_device_type (device_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS devices (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  asset_tag VARCHAR(80) NOT NULL,
  type ENUM('PC', 'Printer') NOT NULL,
  brand VARCHAR(100) NULL,
  model VARCHAR(100) NULL,
  ram VARCHAR(80) NULL,
  motherboard VARCHAR(120) NULL,
  printer_type ENUM('Laser', 'Inkjet or ink tank', 'Other') NULL,
  supply_model VARCHAR(120) NULL,
  ip_address VARCHAR(45) NULL,
  serial_no VARCHAR(120) NULL,
  department_id INT UNSIGNED NULL,
  location VARCHAR(150) NULL,
  assigned_user_id INT UNSIGNED NULL,
  status ENUM('Active', 'Retired') NOT NULL DEFAULT 'Active',
  verification ENUM('Needs IT check', 'Verified') NOT NULL DEFAULT 'Needs IT check',
  last_serviced DATE NULL,
  next_due DATE NOT NULL,
  postponed_until DATE NULL,
  postpone_reason VARCHAR(500) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_devices_asset_tag (asset_tag),
  KEY idx_devices_type_status (type, status),
  KEY idx_devices_department (department_id),
  KEY idx_devices_assigned_user (assigned_user_id),
  KEY idx_devices_next_due (next_due),
  CONSTRAINT fk_devices_department FOREIGN KEY (department_id)
    REFERENCES departments (id) ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_devices_assigned_user FOREIGN KEY (assigned_user_id)
    REFERENCES users (id) ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS maintenance_logs (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  device_id INT UNSIGNED NOT NULL,
  done_by INT UNSIGNED NOT NULL,
  done_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  checklist_results JSON NOT NULL,
  notes TEXT NULL,
  PRIMARY KEY (id),
  KEY idx_maintenance_logs_device_date (device_id, done_at),
  KEY idx_maintenance_logs_done_by (done_by),
  CONSTRAINT fk_maintenance_logs_device FOREIGN KEY (device_id)
    REFERENCES devices (id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_maintenance_logs_done_by FOREIGN KEY (done_by)
    REFERENCES users (id) ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tickets (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  ticket_no VARCHAR(20) NOT NULL,
  requester_user_id INT UNSIGNED NULL,
  guest_name VARCHAR(150) NULL,
  guest_email VARCHAR(254) NULL,
  department_id INT UNSIGNED NULL,
  device_id INT UNSIGNED NULL,
  device_text VARCHAR(255) NULL,
  help_topic VARCHAR(100) NOT NULL,
  summary VARCHAR(200) NOT NULL,
  details TEXT NOT NULL,
  priority ENUM('Low', 'Normal', 'High', 'Urgent') NOT NULL DEFAULT 'Normal',
  source ENUM('Guest', 'Signed in', 'Walk-in') NOT NULL,
  status ENUM('Open', 'In progress', 'Waiting for parts', 'Resolved', 'Closed') NOT NULL DEFAULT 'Open',
  assigned_to INT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  resolved_at DATETIME NULL,
  closed_at DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tickets_ticket_no (ticket_no),
  KEY idx_tickets_requester_status (requester_user_id, status),
  KEY idx_tickets_assignee_status (assigned_to, status),
  KEY idx_tickets_status_created (status, created_at),
  KEY idx_tickets_department (department_id),
  KEY idx_tickets_device (device_id),
  CONSTRAINT fk_tickets_requester FOREIGN KEY (requester_user_id)
    REFERENCES users (id) ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_tickets_department FOREIGN KEY (department_id)
    REFERENCES departments (id) ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_tickets_device FOREIGN KEY (device_id)
    REFERENCES devices (id) ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_tickets_assigned_to FOREIGN KEY (assigned_to)
    REFERENCES users (id) ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ticket_updates (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  ticket_id INT UNSIGNED NOT NULL,
  user_id INT UNSIGNED NULL,
  note TEXT NOT NULL,
  old_status ENUM('Open', 'In progress', 'Waiting for parts', 'Resolved', 'Closed') NULL,
  new_status ENUM('Open', 'In progress', 'Waiting for parts', 'Resolved', 'Closed') NULL,
  visible_to_requester BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ticket_updates_ticket_date (ticket_id, created_at),
  KEY idx_ticket_updates_user (user_id),
  CONSTRAINT fk_ticket_updates_ticket FOREIGN KEY (ticket_id)
    REFERENCES tickets (id) ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_ticket_updates_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
