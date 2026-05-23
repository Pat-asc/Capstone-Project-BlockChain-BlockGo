const { parentPort, workerData } = require('worker_threads');
const { spawn } = require('child_process');
const fs = require('fs');

const { mapperPath, filePath, facultyId, INTERNAL_API_KEY, term } = workerData;

const pythonProcess = spawn('python3', [
    mapperPath,
    filePath,
    facultyId,
    INTERNAL_API_KEY,
    term || ''
]);

let output = '';
let errorOutput = '';

pythonProcess.stdout.on('data', (data) => output += data.toString());
pythonProcess.stderr.on('data', (data) => errorOutput += data.toString());

pythonProcess.on('error', (err) => {
    parentPort.postMessage({ status: 'error', error: err.message });
});

pythonProcess.on('close', (code) => {
    fs.unlink(filePath, (err) => { if (err) console.error('File cleanup error:', err); });
    if (code === 0) {
        parentPort.postMessage({ status: 'success', output });
    } else {
        parentPort.postMessage({ status: 'error', error: 'Mapper process failed', exitCode: code, output, errorOutput });
    }
});

setTimeout(() => {
    pythonProcess.kill('SIGTERM');
    parentPort.postMessage({ status: 'error', error: 'Batch upload timeout' });
    process.exit(1);
}, 5 * 60 * 1000);
