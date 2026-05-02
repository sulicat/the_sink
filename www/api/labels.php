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

$cutoff = time() - 600;
$db     = get_db();

$stmt = $db->prepare(
    'SELECT DISTINCT label
     FROM data_points
     WHERE timestamp >= :cutoff
     ORDER BY label ASC'
);
$stmt->execute([':cutoff' => $cutoff]);

$labels = $stmt->fetchAll(PDO::FETCH_COLUMN);

echo json_encode(array_values($labels));
