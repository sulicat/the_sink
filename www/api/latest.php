<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');

require_once __DIR__ . '/db.php';

$db  = get_db();
$now = time();
$min = $now - 600;

// Get the single most-recent row per label within the 10-min window
$stmt = $db->prepare('
    SELECT label, value, timestamp
    FROM data_points
    WHERE timestamp >= :min
    AND id IN (
        SELECT MAX(id) FROM data_points
        WHERE timestamp >= :min2
        GROUP BY label
    )
    ORDER BY label ASC
');
$stmt->execute([':min' => $min, ':min2' => $min]);
$rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

$result = [];
foreach ($rows as $row) {
    $result[] = [
        'label'     => $row['label'],
        'value'     => (float) $row['value'],
        'timestamp' => (int)   $row['timestamp'],
    ];
}

echo json_encode($result);
