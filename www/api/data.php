<?php

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

require_once __DIR__ . '/db.php';

$label = $_GET['label'] ?? null;

if ($label === null || trim($label) === '') {
    http_response_code(400);
    echo json_encode(['error' => 'label parameter is required']);
    exit;
}

$label  = trim($label);
$cutoff = time() - 600;

$db   = get_db();
$stmt = $db->prepare(
    'SELECT value, timestamp
     FROM data_points
     WHERE label = :label AND timestamp >= :cutoff
     ORDER BY timestamp ASC
     LIMIT 200'
);
$stmt->execute([':label' => $label, ':cutoff' => $cutoff]);

$rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

$result = array_map(function ($row) {
    return [
        'value'     => (float) $row['value'],
        'timestamp' => (int)   $row['timestamp'],
    ];
}, $rows);

echo json_encode($result);
