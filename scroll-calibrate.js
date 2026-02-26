#!/usr/bin/env node
// Scroll calibration tool
// Press UP/DOWN arrows to scroll via Pico
// Press +/- to adjust scroll amount
// Press Q to quit

const { SerialPort } = require('serialport');
const { execSync } = require('child_process');

// Find Pico
const ports = execSync('ls /dev/tty.usbmodem*').toString().trim().split('\n');
const picoPort = ports[0];
console.log(`🔗 Connecting to ${picoPort}`);

const port = new SerialPort({ path: picoPort, baudRate: 115200 });

let scrollAmount = 100;
let buffer = '';

port.on('data', (data) => {
    buffer += data.toString();
    while (buffer.includes('\n')) {
        const line = buffer.substring(0, buffer.indexOf('\n')).trim();
        buffer = buffer.substring(buffer.indexOf('\n') + 1);
    }
});

port.on('open', () => {
    console.log(`\n📜 Scroll Calibration Tool`);
    console.log(`─────────────────────────`);
    console.log(`Current amount: ${scrollAmount}`);
    console.log(`\nControls:`);
    console.log(`  ↓ / j  = scroll DOWN by ${scrollAmount}`);
    console.log(`  ↑ / k  = scroll UP by ${scrollAmount}`);
    console.log(`  + / =  = increase amount by 10`);
    console.log(`  - / _  = decrease amount by 10`);
    console.log(`  ] = increase by 1`);
    console.log(`  [ = decrease by 1`);
    console.log(`  q = quit\n`);

    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    stdin.on('data', (key) => {
        // Ctrl+C
        if (key === '\u0003' || key === 'q') {
            console.log('\n👋 Bye');
            port.close();
            process.exit();
        }

        // Arrow keys come as escape sequences
        if (key === '\u001b[B' || key === 'j') {
            // Down arrow or j
            console.log(`📜 SCROLL DOWN: ${scrollAmount} units`);
            port.write(`SCROLL,${scrollAmount}\r\n`);
        } else if (key === '\u001b[A' || key === 'k') {
            // Up arrow or k
            console.log(`📜 SCROLL UP: ${-scrollAmount} units`);
            port.write(`SCROLL,${-scrollAmount}\r\n`);
        } else if (key === '+' || key === '=') {
            scrollAmount += 10;
            console.log(`   Amount: ${scrollAmount}`);
        } else if (key === '-' || key === '_') {
            scrollAmount = Math.max(1, scrollAmount - 10);
            console.log(`   Amount: ${scrollAmount}`);
        } else if (key === ']') {
            scrollAmount += 1;
            console.log(`   Amount: ${scrollAmount}`);
        } else if (key === '[') {
            scrollAmount = Math.max(1, scrollAmount - 1);
            console.log(`   Amount: ${scrollAmount}`);
        }
    });
});
