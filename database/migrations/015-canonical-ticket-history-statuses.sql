USE it_service_desk;

UPDATE ticket_updates
SET old_status = 'In Progress'
WHERE old_status = 'In progress';

UPDATE ticket_updates
SET new_status = 'In Progress'
WHERE new_status = 'In progress';
