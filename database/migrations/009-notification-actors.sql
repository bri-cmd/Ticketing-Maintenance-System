USE it_service_desk;

ALTER TABLE notifications
  ADD COLUMN actor_user_id INT UNSIGNED NULL AFTER ticket_id,
  ADD KEY idx_notifications_actor (actor_user_id),
  ADD CONSTRAINT fk_notifications_actor FOREIGN KEY (actor_user_id)
    REFERENCES users (id) ON UPDATE CASCADE ON DELETE SET NULL;
