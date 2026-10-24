-- Run this once using a MySQL administrator account.
-- Replace the password below with a strong password, then use the same value in server/.env.
CREATE DATABASE IF NOT EXISTS it_service_desk
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

CREATE USER IF NOT EXISTS 'it_service_desk_app'@'127.0.0.1'
  IDENTIFIED BY '@Password';

GRANT SELECT, INSERT, UPDATE, DELETE
  ON it_service_desk.* TO 'it_service_desk_app'@'127.0.0.1';
