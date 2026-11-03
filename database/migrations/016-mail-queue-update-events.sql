USE it_service_desk;

ALTER TABLE mail_queue
  ADD COLUMN update_events JSON NULL AFTER visible_notes;
