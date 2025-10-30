const SerialPort = require('serialport').SerialPort;
const { ReadlineParser } = require('@serialport/parser-readline');

console.log('🔌 Setting up connection...');

const port = new SerialPort({ 
    path: '/dev/tty.usbmodem1101',
    baudRate: 115200 
});

const parser = port.pipe(new ReadlineParser({ delimiter: '\n' }));

port.on('open', () => {
    console.log('✅ Port opened successfully');
});

port.on('error', (err) => {
    console.log('❌ Port error:', err.message);
});

parser.on('data', (data) => {
    console.log(`📨 Pico says: "${data.trim()}"`);
});

// Wait for connection then send commands
setTimeout(() => {
    console.log('📡 Sending PING...');
    port.write('PING\r\n');  // Added \r
}, 3000);

setTimeout(() => {
    console.log('🖱️  Sending MOVE...');
    port.write('MOVE,60,60\r\n');  // Added \r
}, 5000);

setTimeout(() => {
    console.log('🖱️  Sending CLICK...');
    port.write('CLICK\r\n');  // Added \r
}, 7000);