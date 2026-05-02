<?php

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

require_once __DIR__ . '/db.php';

$label     = null;
$value     = null;
$timestamp = null;

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $body = file_get_contents('php://input');
    $json = json_decode($body, true);

    if ($json !== null) {
        $label     = $json['label']     ?? null;
        $value     = $json['value']     ?? null;
        $timestamp = $json['timestamp'] ?? null;
    } else {
        $label     = $_POST['label']     ?? null;
        $value     = $_POST['value']     ?? null;
        $timestamp = $_POST['timestamp'] ?? null;
    }
} else {
    // GET — for easy browser/curl testing
    $label     = $_GET['label']     ?? null;
    $value     = $_GET['value']     ?? null;
    $timestamp = $_GET['timestamp'] ?? null;
}

if ($label === null || $value === null) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'label and value are required']);
    exit;
}

$label     = trim((string) $label);
$value     = (float) $value;
$timestamp = ($timestamp !== null) ? (int) $timestamp : time();

if ($label === '') {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'label must not be empty']);
    exit;
}

$db = get_db();

$stmt = $db->prepare(
    'INSERT INTO data_points (label, value, timestamp) VALUES (:label, :value, :ts)'
);
$stmt->execute([':label' => $label, ':value' => $value, ':ts' => $timestamp]);

// Prune data older than 10 minutes for this label
$cutoff = time() - 600;
$del = $db->prepare(
    'DELETE FROM data_points WHERE label = :label AND timestamp < :cutoff'
);
$del->execute([':label' => $label, ':cutoff' => $cutoff]);

echo json_encode(['ok' => true]);
