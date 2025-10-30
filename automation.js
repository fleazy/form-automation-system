const SerialPort = require('serialport').SerialPort;
const { ReadlineParser } = require('@serialport/parser-readline');

class SmoothCurveController {
    constructor(portPath) {
        this.port = new SerialPort({ 
            path: portPath, 
            baudRate: 115200 
        });
        
        this.parser = this.port.pipe(new ReadlineParser({ delimiter: '\n' }));
        this.commandQueue = [];
        this.isProcessing = false;
        this.currentPosition = { x: 500, y: 300 };
        this.emergencyStop = false;
        
        process.on('SIGINT', () => {
            console.log('\n🛑 EMERGENCY STOP!');
            this.emergencyStop = true;
            this.port.close();
            process.exit(0);
        });
        
        this.parser.on('data', (data) => {
            const response = data.trim();
            if (response === 'OK' && !this.emergencyStop) {
                this.processNextCommand();
            }
        });
        
        console.log('🚀 Smooth Curve + Scroll Controller ready!');
    }
    
    async sendCommand(command) {
        if (this.emergencyStop) return;
        
        return new Promise((resolve) => {
            this.commandQueue.push({ command, resolve });
            if (!this.isProcessing) {
                this.processNextCommand();
            }
        });
    }
    
    processNextCommand() {
        if (this.commandQueue.length === 0 || this.emergencyStop) {
            this.isProcessing = false;
            return;
        }
        
        this.isProcessing = true;
        const { command, resolve } = this.commandQueue.shift();
        
        this.port.write(command + '\r\n');
        setTimeout(resolve, 12);
    }
    
    async moveRelative(deltaX, deltaY) {
        if (this.emergencyStop) return;
        
        await this.sendCommand(`MOVE,${Math.round(deltaX)},${Math.round(deltaY)}`);
        this.currentPosition.x += deltaX;
        this.currentPosition.y += deltaY;
    }
    
    async click() {
        if (this.emergencyStop) return;
        await this.sendCommand('CLICK');
    }
    
    async scroll(amount) {
        if (this.emergencyStop) return;
        await this.sendCommand(`SCROLL,${amount}`);
    }
    
    // Smooth human-like scrolling
    async smoothScroll(direction, intensity = 5, duration = 2000) {
        if (this.emergencyStop) return;
        
        console.log(`📜 ${direction === 'up' ? '⬆️ ' : '⬇️ '} Smooth scrolling ${direction}...`);
        
        const scrollDirection = direction === 'up' ? -1 : 1;
        const startTime = Date.now();
        const totalScrolls = Math.floor(duration / 100); // Scroll every ~100ms
        
        for (let i = 0; i < totalScrolls; i++) {
            if (this.emergencyStop) break;
            
            // Variable scroll intensity (like human scrolling)
            const progress = i / totalScrolls;
            let scrollAmount = intensity;
            
            // Start slow, speed up, then slow down at the end
            if (progress < 0.2) {
                scrollAmount = Math.floor(intensity * (progress / 0.2) * 0.5 + 1);
            } else if (progress > 0.8) {
                scrollAmount = Math.floor(intensity * ((1 - progress) / 0.2) * 0.5 + 1);
            } else {
                // Add some randomness in the middle
                scrollAmount = intensity + Math.floor((Math.random() - 0.5) * 2);
            }
            
            await this.scroll(scrollAmount * scrollDirection);
            
            // Variable timing (human-like)
            const delay = 80 + Math.random() * 40; // 80-120ms
            await new Promise(resolve => setTimeout(resolve, delay));
        }
        
        console.log(`✅ Scrolling ${direction} complete`);
    }
    
    // Quick scroll bursts (like quick mouse wheel flicks)
    async burstScroll(direction, bursts = 3) {
        if (this.emergencyStop) return;
        
        console.log(`💫 ${direction === 'up' ? '⬆️ ' : '⬇️ '} Burst scrolling ${direction}...`);
        
        const scrollDirection = direction === 'up' ? -1 : 1;
        
        for (let i = 0; i < bursts; i++) {
            if (this.emergencyStop) break;
            
            // Random burst size
            const burstSize = 3 + Math.floor(Math.random() * 5); // 3-7 scrolls
            const scrollAmount = 2 + Math.floor(Math.random() * 3); // 2-4 per scroll
            
            for (let j = 0; j < burstSize; j++) {
                await this.scroll(scrollAmount * scrollDirection);
                await new Promise(resolve => setTimeout(resolve, 20)); // Fast bursts
            }
            
            // Pause between bursts
            if (i < bursts - 1) {
                await new Promise(resolve => setTimeout(resolve, 300 + Math.random() * 200));
            }
        }
        
        console.log(`✅ Burst scrolling complete`);
    }
    
    // Smooth curved movement (keeping the good stuff)
    async moveTo(targetX, targetY, options = {}) {
        if (this.emergencyStop) return;
        
        const start = { ...this.currentPosition };
        const target = { x: targetX, y: targetY };
        
        console.log(`🎯 Smooth curve: (${start.x}, ${start.y}) → (${target.x}, ${target.y})`);
        
        const distance = Math.sqrt(
            Math.pow(target.x - start.x, 2) + Math.pow(target.y - start.y, 2)
        );
        
        const steps = Math.max(6, Math.floor(distance / 20));
        const curveHeight = options.curve || Math.min(30, distance / 8);
        
        const points = [];
        for (let i = 0; i <= steps; i++) {
            const progress = i / steps;
            const easeProgress = 0.5 * (1 - Math.cos(progress * Math.PI));
            
            const baseX = start.x + (target.x - start.x) * easeProgress;
            const baseY = start.y + (target.y - start.y) * easeProgress;
            
            const curveOffset = Math.sin(progress * Math.PI) * curveHeight;
            const randomX = (Math.random() - 0.5) * 0.5;
            const randomY = (Math.random() - 0.5) * 0.5;
            
            points.push({
                x: baseX + randomX,
                y: baseY - curveOffset + randomY
            });
        }
        
        let currentPos = { ...start };
        
        for (let i = 1; i < points.length; i++) {
            if (this.emergencyStop) break;
            
            const point = points[i];
            const deltaX = point.x - currentPos.x;
            const deltaY = point.y - currentPos.y;
            
            if (Math.abs(deltaX) > 1 || Math.abs(deltaY) > 1) {
                await this.moveRelative(deltaX, deltaY);
                currentPos.x += deltaX;
                currentPos.y += deltaY;
                
                await new Promise(resolve => setTimeout(resolve, 15));
            }
        }
        
        const finalDeltaX = target.x - currentPos.x;
        const finalDeltaY = target.y - currentPos.y;
        
        if (Math.abs(finalDeltaX) > 2 || Math.abs(finalDeltaY) > 2) {
            await this.moveRelative(finalDeltaX, finalDeltaY);
        }
        
        this.currentPosition = { x: targetX, y: targetY };
        console.log(`✅ Smooth curve complete`);
    }
    
    setPosition(x, y) {
        this.currentPosition = { x, y };
    }
}

async function curveAndScrollDemo() {
    const controller = new SmoothCurveController('/dev/tty.usbmodem1101');
    
    await new Promise(resolve => setTimeout(resolve, 2000));
    controller.setPosition(400, 300);
    
    console.log('🚨 Curves + Scrolling demo in 3 seconds...');
    for (let i = 3; i > 0; i--) {
        console.log(`🚨 ${i}...`);
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    console.log('✅ Starting curves + scrolling demo!');
    
    // Move and click
    console.log('📍 Moving to first position...');
    await controller.moveTo(200, 200, { curve: 25 });
    await controller.click();
    
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Smooth scroll up
    await controller.smoothScroll('up', 4, 1500);
    
    await new Promise(resolve => setTimeout(resolve, 800));
    
    // Move to different area
    console.log('📍 Moving to center...');
    await controller.moveTo(400, 300, { curve: 20 });
    await controller.click();
    
    await new Promise(resolve => setTimeout(resolve, 400));
    
    // Burst scroll down
    await controller.burstScroll('down', 4);
    
    await new Promise(resolve => setTimeout(resolve, 800));
    
    // Final movement
    console.log('📍 Moving to final position...');
    await controller.moveTo(300, 150, { curve: 15 });
    await controller.click();
    
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Final smooth scroll up
    await controller.smoothScroll('up', 3, 1000);
    
    console.log('🎉 Curves + scrolling demo complete!');
}

curveAndScrollDemo().catch(console.error);