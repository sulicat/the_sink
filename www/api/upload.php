<?php
/* upload.php — Accept multipart file upload and store in appropriate directory */

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
header('Content-Type: application/json');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    echo json_encode(['ok' => false, 'error' => 'Method not allowed']);
    exit;
}

function jsonError($msg) {
    echo json_encode(['ok' => false, 'error' => $msg]);
    exit;
}

// Allowed extensions per type
$allowed = [
    'model'   => ['glb', 'gltf'],
    'skybox'  => ['jpg', 'jpeg', 'png', 'webp', 'hdr'],
    'texture' => ['jpg', 'jpeg', 'png', 'webp'],
];

// Destination directories
$destDirs = [
    'model'   => '/var/www/html/models/',
    'skybox'  => '/var/www/html/skyboxes/',
    'texture' => '/var/www/html/textures/',
];

// URL prefixes
$urlPrefixes = [
    'model'   => '/models/',
    'skybox'  => '/skyboxes/',
    'texture' => '/textures/',
];

// Validate file presence
if (!isset($_FILES['file']) || $_FILES['file']['error'] !== UPLOAD_ERR_OK) {
    $errCode = $_FILES['file']['error'] ?? -1;
    $errMsgs = [
        UPLOAD_ERR_INI_SIZE   => 'File exceeds server upload limit',
        UPLOAD_ERR_FORM_SIZE  => 'File exceeds form upload limit',
        UPLOAD_ERR_PARTIAL    => 'File was only partially uploaded',
        UPLOAD_ERR_NO_FILE    => 'No file was uploaded',
        UPLOAD_ERR_NO_TMP_DIR => 'Missing temporary folder',
        UPLOAD_ERR_CANT_WRITE => 'Failed to write file to disk',
        UPLOAD_ERR_EXTENSION  => 'Upload stopped by extension',
    ];
    jsonError($errMsgs[$errCode] ?? 'Upload error code ' . $errCode);
}

// Validate size (100MB max)
$maxBytes = 100 * 1024 * 1024;
if ($_FILES['file']['size'] > $maxBytes) {
    jsonError('File exceeds 100 MB limit');
}

// Determine type
$type = isset($_POST['type']) ? strtolower(trim($_POST['type'])) : 'texture';
if (!isset($allowed[$type])) {
    jsonError('Invalid type. Must be model, skybox, or texture.');
}

// Get and validate extension
$originalName = $_FILES['file']['name'];
$ext = strtolower(pathinfo($originalName, PATHINFO_EXTENSION));
if (!in_array($ext, $allowed[$type], true)) {
    jsonError('Extension .' . $ext . ' is not allowed for type "' . $type . '". Allowed: ' . implode(', ', $allowed[$type]));
}

// Sanitize filename: keep alphanumeric, dash, underscore, dot
$basename = pathinfo($originalName, PATHINFO_FILENAME);
$basename = preg_replace('/[^a-zA-Z0-9_\-]/', '_', $basename);
$basename = trim($basename, '_') ?: 'upload';
$filename = $basename . '.' . $ext;

// Ensure destination directory exists
$destDir = $destDirs[$type];
if (!is_dir($destDir)) {
    if (!mkdir($destDir, 0777, true)) {
        jsonError('Could not create destination directory');
    }
}

// Handle filename collisions: append _1, _2, etc.
$destPath = $destDir . $filename;
if (file_exists($destPath)) {
    $counter = 1;
    do {
        $filename = $basename . '_' . $counter . '.' . $ext;
        $destPath = $destDir . $filename;
        $counter++;
    } while (file_exists($destPath));
}

// Move uploaded file
if (!move_uploaded_file($_FILES['file']['tmp_name'], $destPath)) {
    jsonError('Failed to move uploaded file to destination');
}

chmod($destPath, 0644);

$url = $urlPrefixes[$type] . $filename;
echo json_encode(['ok' => true, 'url' => $url, 'name' => $filename]);
