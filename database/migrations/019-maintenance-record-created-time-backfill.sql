USE it_service_desk;

UPDATE maintenance_logs
SET created_at = done_at
WHERE created_at > done_at;
