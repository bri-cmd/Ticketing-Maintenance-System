USE it_service_desk;

UPDATE mail_queue
SET available_at = NOW()
WHERE queue_type = 'update'
  AND available_at > DATE_ADD(NOW(), INTERVAL 5 SECOND);
