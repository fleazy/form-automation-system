#!/usr/bin/env node

const net = require('net');

let client = null;

function connectToSimulator() {
  client = new net.Socket();
  
  client.connect(3001, 'localhost', () => {
    
  });
  
  client.on('close', () => {
    client = null;
    setTimeout(connectToSimulator, 1000);
  });
  
  client.on('error', () => {
    setTimeout(connectToSimulator, 1000);
  });
}

function sendToExtension(message) {
  const messageStr = JSON.stringify(message);
  const messageLength = Buffer.byteLength(messageStr, 'utf8');
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(messageLength, 0);
  process.stdout.write(buffer);
  process.stdout.write(messageStr, 'utf8');
}

function readFromExtension() {
  let input = '';
  
  process.stdin.on('data', (chunk) => {
    input += chunk;
    
    while (input.length >= 4) {
      const messageLength = input.readUInt32LE(0);
      
      if (input.length >= 4 + messageLength) {
        const messageStr = input.slice(4, 4 + messageLength).toString('utf8');
        input = input.slice(4 + messageLength);
        
        try {
          const message = JSON.parse(messageStr);
          if (client && (message.type === 'BOTTOM_REACHED' || message.type === 'SCROLL_UPDATE')) {
            client.write(JSON.stringify(message) + '\n');
          }
        } catch (error) {
          
        }
      } else {
        break;
      }
    }
  });
}

connectToSimulator();
readFromExtension();