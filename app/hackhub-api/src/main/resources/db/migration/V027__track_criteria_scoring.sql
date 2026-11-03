-- Add distinct scoring slots; do not reinterpret or delete historical 70/30 ratings.
INSERT INTO voting_criteria(hackathon_id, name, description, weight, display_order)
SELECT h.id, s.name, 'Use the corresponding Individual or Team award-category criterion. Collaboration weights are 30/35/35; Customer Values and Innovation weights are 40/30/30.', s.weight, s.position
FROM hackathons h CROSS JOIN (VALUES
 ('DPA track criterion 1', 40, 0),
 ('DPA track criterion 2', 30, 1),
 ('DPA track criterion 3', 30, 2)
) s(name,weight,position)
WHERE (lower(h.title) LIKE '%digital pioneer%' OR h.title LIKE '%数字先锋%')
ON CONFLICT(hackathon_id,name) DO NOTHING;
