<?php

function get_db() {
    $db_path = '/var/data/sink.db';
    try {
        $db = new PDO('sqlite:' . $db_path);
        $db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

        $db->exec("
            CREATE TABLE IF NOT EXISTS data_points (
                id        INTEGER PRIMARY KEY AUTOINCREMENT,
                label     TEXT NOT NULL,
                value     REAL NOT NULL,
                timestamp INTEGER NOT NULL
            )
        ");

        $db->exec("
            CREATE INDEX IF NOT EXISTS idx_label_ts
            ON data_points (label, timestamp)
        ");

        return $db;
    } catch (PDOException $e) {
        http_response_code(500);
        header('Content-Type: application/json');
        echo json_encode(['ok' => false, 'error' => $e->getMessage()]);
        exit;
    }
}
