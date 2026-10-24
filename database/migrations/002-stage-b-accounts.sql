-- Run once as a MySQL administrator against it_service_desk.
-- The application database user intentionally does not have ALTER privileges.
USE it_service_desk;

ALTER TABLE users
  ADD COLUMN last_sign_in DATETIME NULL AFTER active,
  ADD COLUMN session_version INT UNSIGNED NOT NULL DEFAULT 0 AFTER last_sign_in,
  ADD COLUMN computer_setup JSON NULL AFTER session_version,
  ADD COLUMN onboarding_completed BOOLEAN NOT NULL DEFAULT FALSE AFTER computer_setup;
