USE it_service_desk;

UPDATE notifications AS notification
JOIN tickets AS ticket ON ticket.id = notification.ticket_id
SET notification.actor_user_id = ticket.requester_user_id
WHERE notification.actor_user_id IS NULL
  AND ticket.requester_user_id IS NOT NULL
  AND ticket.source = 'Signed in'
  AND notification.title IN ('Submitted Ticket', 'New employee ticket');
