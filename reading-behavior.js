const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');
const http = require('http');
// ghost-cursor kept for potential future use; movement now uses humanPath()

class ReadingBehaviorSimulator {
    constructor(portPath) {
        this.port = new SerialPort({ 
            path: portPath, 
            baudRate: 115200 
        });
        
        this.parser = this.port.pipe(new ReadlineParser({ delimiter: '\n' }));
        this.commandQueue = [];
        this.isProcessing = false;
        this.currentPosition = { x: 400, y: 300 };
        this.currentHovered = { id: '', name: '' };
        this.emergencyStop = false;
        this.isReading = false;
        
        // Scan-questions support: bulk query all question elements at once
        this.pendingScanRequest = null;
        this.scanResolvers = new Map();
        this.isScrollingBack = false;
        
        // Reading session state
        this.scrollProgress = 0;
        this.targetScrollPercent = 0.3 + Math.random() * 0.2; // 30-50%
        this.sessionStartTime = null;
        this.totalScrollsNeeded = 0;
        this.scrollsCompleted = 0;
        this.extensionServer = null;
        this.isAtPageBottom = false;
        this.isAutomating = false;
        this.detectedFields = null;
        this.pendingCoordRequest = null;
        this.coordResolvers = new Map();
        this.pendingAutomationData = null;
        // Viewport bounds reported by the extension (absolute screen coords).
        // Updated from coord-response and cursor-position messages.
        this.viewportBounds = null;
        
        process.on('SIGINT', () => {
            console.log('\n🛑 STOPPING READING SESSION!');
            this.emergencyStop = true;
            this.isReading = false;
            this.port.close();
            process.exit(0);
        });
        
        this.parser.on('data', (data) => {
            // Log Pico responses for debugging
            console.log(`📥 Pico: ${data.trim()}`);
        });
        
        this.setupExtensionServer();
        
        console.log('📖 Ready — open the form in Chrome, then press F to start.');
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
        
        try {
            this.port.write(command + '\r\n');
            setTimeout(() => {
                resolve();
                // Process next command immediately without waiting for OK
                this.processNextCommand();
            }, 50); // Small delay between commands
        } catch (error) {
            console.error('Serial port write error:', error);
            this.isProcessing = false;
            resolve();
        }
    }
    
    async startReadingSession() {
        if (this.isReading) return;
        
        this.isReading = true;
        this.sessionStartTime = Date.now();
        this.scrollProgress = 0;
        this.scrollsCompleted = 0;
        
        // Simple session - just scroll until we reach target
        const sessionDuration = 180000 + Math.random() * 300000; // 3-8 minutes
        this.totalScrollsNeeded = 20 + Math.floor(Math.random() * 15); // 20-34 total scrolls
        
        console.log('📖 Starting reading session...');
        console.log(`🎯 Target: Scroll ${(this.targetScrollPercent * 100).toFixed(1)}% down over ${(sessionDuration / 60000).toFixed(1)} minutes`);
        console.log(`📊 Planning ${this.totalScrollsNeeded} scroll actions`);
        console.log('⏹️  Press Ctrl+C to stop\n');
        
        // Start the reading behavior loops
        this.scheduleNextScroll();
        this.scheduleNextMouseMovement();
        
        // Stop after session duration
        setTimeout(() => {
            if (this.isReading) {
                this.finishReadingSession();
            }
        }, sessionDuration);
    }
    
    async scheduleNextScroll() {
        if (!this.isReading || this.emergencyStop) return;
        
        // Longer delays between actions (8-25 seconds)
        const delay = 8000 + Math.random() * 17000;
        
        setTimeout(async () => {
            if (!this.isReading || this.emergencyStop) return;
            
            await this.simulateReadingScroll();
            this.scheduleNextScroll(); // Schedule next scroll
        }, delay);
    }
    
    async simulateReadingScroll() {
        if (this.scrollProgress >= this.targetScrollPercent || this.isAtPageBottom) {
            this.finishReadingSession();
            return;
        }
        
        // Random behavior - much simpler
        const rand = Math.random();
        
        // 20% chance for burst scrolling
        if (rand < 0.20) {
            await this.randomBurstScroll();
            return;
        }
        
        // 10% chance for reading break
        if (rand < 0.30) {
            const restTime = 2000 + Math.random() * 6000; // 2-8 second rest
            console.log(`😴 Reading break for ${(restTime/1000).toFixed(1)}s...`);
            await new Promise(resolve => setTimeout(resolve, restTime));
            return;
        }
        
        // 70% chance for big random scroll
        await this.randomScroll();
    }
    
    async randomScroll() {
        // Smaller scroll amounts for Chrome (120-170 units)
        const scrollAmount = 120 + Math.floor(Math.random() * 51);
        
        // Realistic progress - each scroll unit = actual page progress
        const progressIncrement = scrollAmount / 3000;
        
        console.log(`📜 Random scroll (${scrollAmount} units) - Progress: ${(this.scrollProgress * 100).toFixed(1)}%`);
        
        await this.sendCommand(`SCROLL,${scrollAmount}`);
        
        this.scrollProgress += progressIncrement;
        this.scrollsCompleted++;
        
        // Random pause
        await new Promise(resolve => setTimeout(resolve, 200 + Math.random() * 400));
    }
    
    async randomBurstScroll() {
        const burstSize = 2 + Math.floor(Math.random() * 3); // 2-4 quick scrolls
        const scrollAmount = 120 + Math.floor(Math.random() * 51); // 120-170 units per scroll
        
        console.log(`💨 Burst scrolling ${burstSize} times (${scrollAmount} units each)`);
        
        for (let i = 0; i < burstSize; i++) {
            if (this.emergencyStop || !this.isReading) break;
            
            await this.sendCommand(`SCROLL,${scrollAmount}`);
            
            // Realistic progress
            this.scrollProgress += scrollAmount / 3000;
            this.scrollsCompleted++;
            
            // Random timing between bursts
            await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 200));
        }
        
        // Random pause after burst
        await new Promise(resolve => setTimeout(resolve, 500 + Math.random() * 1000));
    }
    
    async burstAndReturn() {
        // Remember current position
        const startProgress = this.scrollProgress;
        
        // Burst down a bigger amount
        const burstDistance = 15 + Math.floor(Math.random() * 20); // 15-34 scroll units
        const burstSize = 3 + Math.floor(Math.random() * 3); // 3-5 scrolls
        const scrollPerBurst = Math.ceil(burstDistance / burstSize);
        
        console.log(`🔽 Burst-and-return: scrolling down ${burstDistance} units then back...`);
        
        // Burst down
        for (let i = 0; i < burstSize; i++) {
            if (this.emergencyStop || !this.isReading) break;
            await this.sendCommand(`SCROLL,${scrollPerBurst}`);
            await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 50));
        }
        
        // Brief pause
        await new Promise(resolve => setTimeout(resolve, 200 + Math.random() * 300));
        
        // Return with slight overshoot
        const returnDistance = burstDistance + Math.floor(Math.random() * 6) - 3; // ±3 overshoot
        const returnSize = 2 + Math.floor(Math.random() * 3); // 2-4 scrolls back
        const scrollPerReturn = Math.ceil(returnDistance / returnSize);
        
        console.log(`🔼 Returning with ${returnDistance} units (${returnSize} scrolls)`);
        
        for (let i = 0; i < returnSize; i++) {
            if (this.emergencyStop || !this.isReading) break;
            await this.sendCommand(`SCROLL,${-scrollPerReturn}`);
            await new Promise(resolve => setTimeout(resolve, 120 + Math.random() * 80));
        }
        
        // Don't update reading progress for this exploration (net zero movement)
        console.log(`✅ Finished burst exploration, continuing reading...`);
    }
    
    async scrollToBottomAndBack() {
        console.log(`🔄 Scrolling to bottom to check page length...`);
        
        // Remember current position
        const currentProgress = this.scrollProgress;
        
        // Burst scroll to bottom
        const scrollsToBottom = 15 + Math.floor(Math.random() * 10); // 15-24 big scrolls
        for (let i = 0; i < scrollsToBottom; i++) {
            if (this.emergencyStop || !this.isReading) break;
            await this.sendCommand(`SCROLL,${8 + Math.floor(Math.random() * 5)}`);
            await new Promise(resolve => setTimeout(resolve, 60 + Math.random() * 40));
        }
        
        // Pause at bottom
        await new Promise(resolve => setTimeout(resolve, 500 + Math.random() * 1000));
        
        console.log(`⬆️  Scrolling back up with overshoot...`);
        
        // Scroll back up with overshoot and correction
        const scrollsUp = scrollsToBottom + Math.floor(Math.random() * 6) - 3; // ±3 overshoot
        for (let i = 0; i < scrollsUp; i++) {
            if (this.emergencyStop || !this.isReading) break;
            await this.sendCommand(`SCROLL,${-(6 + Math.floor(Math.random() * 4))}`);
            await new Promise(resolve => setTimeout(resolve, 70 + Math.random() * 50));
        }
        
        // Small correction scrolls
        const corrections = 1 + Math.floor(Math.random() * 4);
        for (let i = 0; i < corrections; i++) {
            if (this.emergencyStop || !this.isReading) break;
            const correctionAmount = Math.random() > 0.5 ? 
                (1 + Math.floor(Math.random() * 3)) : 
                -(1 + Math.floor(Math.random() * 3));
            await this.sendCommand(`SCROLL,${correctionAmount}`);
            await new Promise(resolve => setTimeout(resolve, 200 + Math.random() * 200));
        }
        
        // Don't update reading progress for this exploration
        console.log(`✅ Finished exploring page, continuing reading...`);
    }
    
    async scheduleNextMouseMovement() {
        if (!this.isReading || this.emergencyStop || this.isScrollingBack) return;
        
        // Random delay between mouse movements (20-36 seconds)
        const delay = 20000 + Math.random() * 16000;
        
        setTimeout(async () => {
            if (!this.isReading || this.emergencyStop || this.isScrollingBack) return;
            
            await this.simulateReadingMouseMovement();
            this.scheduleNextMouseMovement(); // Schedule next movement
        }, delay);
    }
    
    async simulateReadingMouseMovement() {
        // Very long random movements (100-400 pixels)
        const distance = 100 + Math.random() * 300;
        const angle = Math.random() * Math.PI * 2; // Random direction
        
        const deltaX = Math.cos(angle) * distance;
        const deltaY = Math.sin(angle) * distance;
        
        console.log(`🖱️  Very long mouse movement: (${deltaX.toFixed(1)}, ${deltaY.toFixed(1)}) - ${distance.toFixed(1)}px`);
        
        await this.ghostCursorMovement(deltaX, deltaY);
    }
    
    async ghostCursorMovement(deltaX, deltaY) {
        const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
        
        // Minimal curve (2-8% of distance, never more than 15px)
        const maxCurve = Math.min(15, distance * 0.08);
        const curveHeight = 2 + Math.random() * Math.min(6, maxCurve);
        
        // Steps based on distance for natural movement
        const steps = Math.max(12, Math.floor(distance / 8));
        
        // Random curve direction
        const curveDirection = Math.random() > 0.5 ? 1 : -1;
        
        const points = [];
        for (let i = 0; i <= steps; i++) {
            const progress = i / steps;
            
            // Ghost cursor style easing with overshoot
            let easeProgress;
            if (progress < 0.25) {
                // Slow start
                easeProgress = 2 * Math.pow(progress, 2);
            } else if (progress < 0.75) {
                // Fast middle with slight overshoot
                const t = (progress - 0.25) / 0.5;
                easeProgress = 0.125 + t * 0.9 + Math.sin(t * Math.PI) * 0.02;
            } else {
                // Decelerate to target
                const t = (progress - 0.75) / 0.25;
                easeProgress = 1.025 - 0.025 * Math.pow(1 - t, 2);
            }
            
            easeProgress = Math.max(0, Math.min(1, easeProgress));
            
            const baseX = deltaX * easeProgress;
            const baseY = deltaY * easeProgress;
            
            // Small curve perpendicular to movement
            const angle = Math.atan2(deltaY, deltaX);
            const perpAngle = angle + Math.PI / 2;
            
            // Natural curve that peaks in middle
            let curveOffset = 0;
            if (progress > 0.1 && progress < 0.9) {
                const curveProgress = (progress - 0.1) / 0.8;
                curveOffset = Math.sin(curveProgress * Math.PI) * curveHeight * curveDirection;
            }
            
            // Human tremor
            const tremor = 0.8;
            const tremorX = (Math.random() - 0.5) * tremor;
            const tremorY = (Math.random() - 0.5) * tremor;
            
            points.push({
                x: baseX + Math.cos(perpAngle) * curveOffset + tremorX,
                y: baseY + Math.sin(perpAngle) * curveOffset + tremorY
            });
        }
        
        // Execute movement with ghost cursor timing
        for (let i = 1; i < points.length; i++) {
            if (this.emergencyStop || !this.isReading) break;
            
            const point = points[i];
            const prevPoint = points[i - 1];
            const stepDeltaX = point.x - prevPoint.x;
            const stepDeltaY = point.y - prevPoint.y;
            
            if (Math.abs(stepDeltaX) > 1 || Math.abs(stepDeltaY) > 1) {
                await this.sendCommand(`MOVE,${Math.round(stepDeltaX)},${Math.round(stepDeltaY)}`);
                
                // Ghost cursor style timing - variable speed
                const progress = i / points.length;
                let delay;
                if (progress < 0.25) {
                    delay = 25 + Math.random() * 10; // Slow start
                } else if (progress < 0.75) {
                    delay = 8 + Math.random() * 6; // Fast middle
                } else {
                    delay = 15 + Math.random() * 10; // Slow end
                }
                
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
        
        // Final correction if needed
        const finalDeltaX = this.currentPosition.x + deltaX - (this.currentPosition.x + points[points.length - 1].x);
        const finalDeltaY = this.currentPosition.y + deltaY - (this.currentPosition.y + points[points.length - 1].y);
        
        if (Math.abs(finalDeltaX) > 2 || Math.abs(finalDeltaY) > 2) {
            await this.sendCommand(`MOVE,${Math.round(finalDeltaX)},${Math.round(finalDeltaY)}`);
        }
        
        // Update position
        this.currentPosition.x += deltaX;
        this.currentPosition.y += deltaY;
    }
    
    async finishReadingSession() {
        if (!this.isReading) return; // Prevent multiple calls
        
        this.isReading = false; // Stop everything immediately
        
        const sessionTime = ((Date.now() - this.sessionStartTime) / 60000).toFixed(1);
        
        console.log('\n✅ Reading session complete!');
        console.log(`📊 Final stats:`);
        console.log(`   ⏱️  Duration: ${sessionTime} minutes`);
        console.log(`   📜 Scrolls: ${this.scrollsCompleted}/${this.totalScrollsNeeded}`);
        console.log(`   📈 Progress: ${(this.scrollProgress * 100).toFixed(1)}% (target: ${(this.targetScrollPercent * 100).toFixed(1)}%)`);
        
        // Wait random time then scroll back up
        const waitTime = 20000 + Math.random() * 220000; // 20 seconds to 4 minutes
        console.log(`\n⏳ Waiting ${(waitTime/1000).toFixed(1)}s before scrolling back up...`);
        
        await new Promise(resolve => setTimeout(resolve, waitTime));
        
        if (!this.emergencyStop) {
            await this.scrollBackToTop();
        }
        
        console.log('\n📋 Load another page and press Enter to start a new reading session...');
    }
    
    async scrollBackToTop() {
        this.isScrollingBack = true;
        console.log('\n🔼 Scrolling back up with natural bursts...');
        
        // Random number of burst scrolls (3-4)
        const burstScrolls = 3 + Math.floor(Math.random() * 2);
        
        console.log(`💨 ${burstScrolls} random burst scrolls back to top`);
        
        for (let i = 0; i < burstScrolls; i++) {
            if (this.emergencyStop) break;
            
            // Each burst is a random amount (150-400 units)
            const burstAmount = 150 + Math.floor(Math.random() * 251);
            
            await this.sendCommand(`SCROLL,${-burstAmount}`);
            console.log(`   ⬆️ Burst ${i + 1}: ${burstAmount} units up`);
            
            // Random timing between bursts (300-800ms)
            const pauseTime = 300 + Math.random() * 500;
            await new Promise(resolve => setTimeout(resolve, pauseTime));
        }
        
        // Small correction scrolls to fine-tune position
        const corrections = 1 + Math.floor(Math.random() * 3); // 1-3 corrections
        console.log(`🎯 Making ${corrections} correction scrolls...`);
        
        for (let i = 0; i < corrections; i++) {
            if (this.emergencyStop) break;
            
            const correctionAmount = 20 + Math.floor(Math.random() * 40); // 20-60 units
            const direction = Math.random() > 0.5 ? 1 : -1; // Random up/down
            
            await this.sendCommand(`SCROLL,${correctionAmount * direction}`);
            await new Promise(resolve => setTimeout(resolve, 200 + Math.random() * 200));
        }
        
        // Reset position to top area
        this.scrollProgress = Math.random() * 0.1; // 0-10%
        
        console.log(`✅ Scrolled back to ~${(this.scrollProgress * 100).toFixed(1)}% position`);
        
        this.isScrollingBack = false;
    }
    
    // Move to absolute screen coordinates.
    // Extension gives us exact target + cursor coords. Step linearly toward
    // the target in small increments to stay below OS pointer acceleration.
    // Clamps target to viewport bounds so the cursor never leaves the page.
    async moveToAbs(targetX, targetY, startPos = null) {
        // Clamp target to viewport bounds (never click dock/menubar/off-page)
        if (this.viewportBounds) {
            const b = this.viewportBounds;
            const MARGIN = 10; // stay 10px inside edges
            targetX = Math.max(b.left + MARGIN, Math.min(b.right - MARGIN, targetX));
            targetY = Math.max(b.top + MARGIN, Math.min(b.bottom - MARGIN, targetY));
        } else {
            console.log(`   ⚠️  no viewport bounds yet — waiting for extension report...`);
            // Wait up to 2s for bounds to arrive from extension
            for (let i = 0; i < 20 && !this.viewportBounds; i++) {
                await new Promise(r => setTimeout(r, 100));
            }
            if (this.viewportBounds) {
                const b = this.viewportBounds;
                const MARGIN = 10;
                targetX = Math.max(b.left + MARGIN, Math.min(b.right - MARGIN, targetX));
                targetY = Math.max(b.top + MARGIN, Math.min(b.bottom - MARGIN, targetY));
            } else {
                console.log(`   ⚠️  still no bounds — REFUSING to move (would risk clicking dock/menubar)`);
                return;
            }
        }

        let from;
        if (startPos !== null && typeof startPos.x === 'number' && typeof startPos.y === 'number') {
            from = { x: startPos.x, y: startPos.y };
        } else {
            await new Promise(r => setTimeout(r, 200));
            from = { ...this.currentPosition };
        }

        const dx = targetX - from.x;
        const dy = targetY - from.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        console.log(`🖱️  move: (${Math.round(from.x)},${Math.round(from.y)}) → (${targetX},${targetY})  dist=${Math.round(dist)}px`);

        if (dist < 3) {
            this.currentPosition = { x: targetX, y: targetY };
            return;
        }

        // Overshoot: move a few px past target in the direction of travel, then pull back
        const overshootMag = (dist > 20) ? (5 + Math.random() * 14) : 0;
        const len = Math.max(dist, 1);
        let overshootX = Math.round(targetX + (dx / len) * overshootMag);
        let overshootY = Math.round(targetY + (dy / len) * overshootMag);
        // Clamp overshoot to viewport bounds too
        if (this.viewportBounds) {
            const b = this.viewportBounds;
            const MARGIN = 5;
            overshootX = Math.max(b.left + MARGIN, Math.min(b.right - MARGIN, overshootX));
            overshootY = Math.max(b.top + MARGIN, Math.min(b.bottom - MARGIN, overshootY));
        }
        const fullDx = overshootX - from.x;
        const fullDy = overshootY - from.y;
        const fullDist = Math.sqrt(fullDx * fullDx + fullDy * fullDy);

        const STEP = 15; // px per step — no pointer acceleration, go fast
        const steps = Math.ceil(fullDist / STEP);
        let sentX = 0, sentY = 0;

        for (let i = 1; i <= steps; i++) {
            if (this.emergencyStop) break;
            const wantX = Math.round(fullDx * i / steps);
            const wantY = Math.round(fullDy * i / steps);
            let sdx = wantX - sentX;
            let sdy = wantY - sentY;
            // Occasional ±1px jitter so the path isn't a perfectly straight line
            if (Math.random() < 0.15) sdx += Math.random() < 0.5 ? -1 : 1;
            if (sdx !== 0 || sdy !== 0) {
                this.port.write(`MOVE,${sdx},${sdy}\r\n`);
                sentX = wantX;
                sentY = wantY;
            }
            await new Promise(r => setTimeout(r, 8 + Math.round(Math.random() * 3)));
        }

        // Pause at overshoot, then pull back to actual target
        if (overshootMag > 0) {
            await new Promise(r => setTimeout(r, 25 + Math.round(Math.random() * 45)));
            const backDx = targetX - overshootX;
            const backDy = targetY - overshootY;
            const backSteps = Math.max(1, Math.ceil(Math.sqrt(backDx * backDx + backDy * backDy)));
            let bSentX = 0, bSentY = 0;
            for (let s = 1; s <= backSteps; s++) {
                if (this.emergencyStop) break;
                const wbx = Math.round(backDx * s / backSteps) - bSentX;
                const wby = Math.round(backDy * s / backSteps) - bSentY;
                if (wbx !== 0 || wby !== 0) {
                    this.port.write(`MOVE,${wbx},${wby}\r\n`);
                    bSentX += wbx; bSentY += wby;
                }
                await new Promise(r => setTimeout(r, 12 + Math.round(Math.random() * 8)));
            }
        }

        // Brief settle for browser mousemove events
        await new Promise(r => setTimeout(r, 80));

        const errX = targetX - this.currentPosition.x;
        const errY = targetY - this.currentPosition.y;
        const errDist = Math.sqrt(errX * errX + errY * errY);
        if (errDist > 5) {
            console.log(`   ⚠️  landed at (${Math.round(this.currentPosition.x)},${Math.round(this.currentPosition.y)}) — correcting ${errDist.toFixed(1)}px`);
            const csteps = Math.max(1, Math.ceil(errDist / 2));
            for (let s = 1; s <= csteps; s++) {
                if (this.emergencyStop) break;
                const rdx = Math.round(errX * s / csteps) - Math.round(errX * (s - 1) / csteps);
                const rdy = Math.round(errY * s / csteps) - Math.round(errY * (s - 1) / csteps);
                if (rdx !== 0 || rdy !== 0) {
                    this.port.write(`MOVE,${rdx},${rdy}\r\n`);
                    await new Promise(r => setTimeout(r, 25));
                }
            }
        } else {
            console.log(`   ✅ within ${errDist.toFixed(1)}px`);
        }

        this.currentPosition = { x: targetX, y: targetY };
    }

    async scrollToElement(selector, options = {}) {
        // Feedback-loop scroll: send one burst, ask extension if element is in view, repeat.
        // No calibration constants needed — the extension tells us the truth each time.
        const MAX_ATTEMPTS = 15;

        let coords = await this.getLiveCoords(selector, options);
        if (!coords.found || coords.inViewport) return coords;

        let lastDirection = 1;
        let attempts = 0;

        while (!coords.inViewport && attempts < MAX_ATTEMPTS) {
            if (this.emergencyStop) break;

            const delta = coords.scrollDeltaNeeded || (coords.viewportTop < 0
                ? coords.viewportTop
                : coords.viewportTop - (coords.viewportH || 800));
            lastDirection = delta > 0 ? 1 : -1;

            const units = 120 + Math.floor(Math.random() * 51); // 120-170, same as randomScroll
            console.log(`📜 Scroll ${attempts + 1}/${MAX_ATTEMPTS}: delta=${delta}px → ${lastDirection * units} units`);
            await this.sendCommand(`SCROLL,${lastDirection * units}`);
            await new Promise(r => setTimeout(r, 80 + Math.round(Math.random() * 80)));

            coords = await this.getLiveCoords(selector, options);
            if (!coords.found) break;
            attempts++;
        }

        if (coords.inViewport) {
            // Small overshoot + pullback for naturalness
            const overshoot = 15 + Math.floor(Math.random() * 20);
            await this.sendCommand(`SCROLL,${lastDirection * overshoot}`);
            await new Promise(r => setTimeout(r, 60 + Math.round(Math.random() * 40)));
            const pullback = 10 + Math.floor(Math.random() * 10);
            await this.sendCommand(`SCROLL,${-lastDirection * pullback}`);
            await new Promise(r => setTimeout(r, 60 + Math.round(Math.random() * 40)));
            console.log(`📜 In view after ${attempts} scroll(s)`);
        } else {
            console.log(`📜 ⚠️  element still not in view after ${MAX_ATTEMPTS} attempts`);
        }

        await new Promise(r => setTimeout(r, 150)); // settle
        return coords;
    }

    isHoveringSelector(selector) {
        const { id, name } = this.currentHovered;
        if (selector.startsWith('#')) return id === selector.slice(1);
        const m = selector.match(/\[name="([^"]+)"\]/);
        if (m) return name === m[1];
        return false;
    }

    waitForHover(selector, timeout = 500) {
        return new Promise(resolve => {
            if (this.isHoveringSelector(selector)) { resolve(true); return; }
            const deadline = Date.now() + timeout;
            const tick = setInterval(() => {
                if (this.isHoveringSelector(selector)) { clearInterval(tick); resolve(true); }
                else if (Date.now() >= deadline)        { clearInterval(tick); resolve(false); }
            }, 20);
        });
    }

    // Ask content.js for the current screen coordinates of an element.
    // content.js polls /coord-request, scrolls the element into view,
    // Bulk-scan all question elements on the page. The extension polls
    // /scan-request, runs the scan, and posts back to /scan-response.
    scanQuestions() {
        return new Promise((resolve, reject) => {
            const requestId = 'scan-' + Date.now();
            this.pendingScanRequest = { requestId };
            this.scanResolvers.set(requestId, resolve);
            setTimeout(() => {
                if (this.scanResolvers.has(requestId)) {
                    this.scanResolvers.delete(requestId);
                    this.pendingScanRequest = null;
                    reject(new Error('Scan request timed out'));
                }
            }, 10000); // 10s — scanning many elements takes time
        });
    }

    // and posts back to /coord-response with fresh coords.
    getLiveCoords(selector, { labelText } = {}) {
        return new Promise((resolve, reject) => {
            const requestId = Date.now().toString();
            this.pendingCoordRequest = { requestId, selector, ...(labelText ? { labelText } : {}) };
            this.coordResolvers.set(requestId, resolve);
            setTimeout(() => {
                if (this.coordResolvers.has(requestId)) {
                    this.coordResolvers.delete(requestId);
                    this.pendingCoordRequest = null;
                    reject(new Error(`Coord request timed out for: ${selector}${labelText ? ' | ' + labelText : ''}`));
                }
            }, 5000);
        });
    }

    setupExtensionServer() {
        this.extensionServer = http.createServer((req, res) => {
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
            
            if (req.method === 'OPTIONS') {
                res.writeHead(200);
                res.end();
                return;
            }
            
            if (req.method === 'POST' && req.url === '/bottom-reached') {
                console.log('🔴 BOTTOM REACHED');
                if (!this.isAutomating) {
                    this.isAtPageBottom = true;
                    if (this.isReading) {
                        this.finishReadingSession();
                    }
                } else {
                    console.log('   (automation in progress, continuing...)');
                }
                res.writeHead(200);
                res.end('OK');
            } else if (req.method === 'POST' && req.url === '/automation') {
                let body = '';
                req.on('data', chunk => body += chunk);
                req.on('end', () => {
                    try {
                        const data = JSON.parse(body);
                        this.pendingAutomationData = data;
                        const count = (data.commands || []).length;
                        console.log(`📥 Queued ${count} commands — press F in the browser to run`);
                        res.writeHead(200);
                        res.end('OK');
                    } catch (error) {
                        res.writeHead(400);
                        res.end('Invalid JSON');
                    }
                });
            } else if (req.method === 'POST' && req.url === '/start') {
                if (!this.pendingAutomationData) {
                    res.writeHead(400);
                    res.end('No pending commands');
                    return;
                }
                console.log('▶️  F pressed — starting automation');
                this.handleAutomationCommands(this.pendingAutomationData);
                this.pendingAutomationData = null;
                res.writeHead(200);
                res.end('OK');
            } else if (req.method === 'POST' && req.url === '/dom-change') {
                let body = '';
                req.on('data', chunk => body += chunk);
                req.on('end', () => {
                    try {
                        const d = JSON.parse(body);
                        console.log(`🔔 DOM change: [${d.label}] ${d.type} → "${d.option || d.value || ''}" checked=${d.checked}`);
                    } catch (_) {}
                    res.writeHead(200);
                    res.end('OK');
                });
            } else if (req.method === 'POST' && req.url === '/trigger-scan') {
                // Trigger a bulk scan and return the results synchronously
                this.scanQuestions().then(result => {
                    res.setHeader('Content-Type', 'application/json');
                    res.writeHead(200);
                    res.end(JSON.stringify(result));
                }).catch(err => {
                    res.writeHead(500);
                    res.end(JSON.stringify({ error: err.message }));
                });
            } else if (req.method === 'POST' && req.url === '/test-move') {
                // Delayed test so you can run curl then switch to the browser.
                // Body: { "delay": 4000, "moves": [[x1,y1],[x2,y2],...] }
                let body = '';
                req.on('data', chunk => body += chunk);
                req.on('end', async () => {
                    let opts = {};
                    try { opts = JSON.parse(body); } catch (_) {}
                    const delay = opts.delay ?? 4000;
                    const moves = opts.moves ?? [];
                    // If the page passed the cursor position from the click event,
                    // use it for the first move so we start from the right place.
                    const clickCursor = (typeof opts.cursorX === 'number' && typeof opts.cursorY === 'number')
                        ? { x: opts.cursorX, y: opts.cursorY } : null;
                    if (clickCursor) {
                        this.currentPosition = { ...clickCursor };
                        console.log(`📍 Cursor at (${clickCursor.x}, ${clickCursor.y}) from click event`);
                    }
                    res.writeHead(200);
                    res.end(`OK — moving in ${delay}ms`);
                    console.log(`🖱️  Test move in ${delay}ms...`);
                    await new Promise(r => setTimeout(r, delay));
                    let startPos = clickCursor;
                    for (const [x, y] of moves) {
                        console.log(`   → moveToAbs(${x}, ${y})`);
                        await this.moveToAbs(x, y, startPos);
                        startPos = null; // only use provided pos for first move
                        await new Promise(r => setTimeout(r, 300 + Math.random() * 200));
                    }
                    console.log('✅ Test move done');
                });
            } else if (req.method === 'POST' && req.url === '/cursor-position') {
                let body = '';
                req.on('data', chunk => body += chunk);
                req.on('end', () => {
                    try {
                        const data = JSON.parse(body);
                        if (typeof data.x === 'number') {
                            this.currentPosition = { x: data.x, y: data.y };
                            this.currentHovered = { id: data.hoveredId || '', name: data.hoveredName || '' };
                        }
                        // Update viewport bounds if the extension sent them
                        if (data.vpLeft !== undefined) {
                            this.viewportBounds = {
                                left: data.vpLeft, top: data.vpTop,
                                right: data.vpRight, bottom: data.vpBottom
                            };
                        }
                    } catch (_) {}
                    res.writeHead(200);
                    res.end('OK');
                });
            } else if (req.method === 'POST' && req.url === '/cursor-hover') {
                let body = '';
                req.on('data', chunk => body += chunk);
                req.on('end', () => {
                    try {
                        const data = JSON.parse(body);
                        this.currentHovered = { id: data.hoveredId || '', name: data.hoveredName || '' };
                    } catch (_) {}
                    res.writeHead(200);
                    res.end('OK');
                });
            } else if (req.method === 'GET' && req.url === '/coord-request') {
                // content.js polls this to see if there's a pending coord request
                res.setHeader('Content-Type', 'application/json');
                res.writeHead(200);
                res.end(JSON.stringify(this.pendingCoordRequest || {}));
            } else if (req.method === 'POST' && req.url === '/coord-response') {
                let body = '';
                req.on('data', chunk => body += chunk);
                req.on('end', () => {
                    try {
                        const data = JSON.parse(body);
                        const resolve = this.coordResolvers.get(data.requestId);
                        if (resolve) {
                            this.coordResolvers.delete(data.requestId);
                            this.pendingCoordRequest = null;
                            // Update viewport bounds from coord-response (most reliable source)
                            if (data.vpLeft !== undefined) {
                                this.viewportBounds = {
                                    left: data.vpLeft, top: data.vpTop,
                                    right: data.vpRight, bottom: data.vpBottom
                                };
                            }
                            resolve(data);
                        }
                        res.writeHead(200);
                        res.end('OK');
                    } catch (e) {
                        res.writeHead(400);
                        res.end('Invalid JSON');
                    }
                });
            } else if (req.method === 'GET' && req.url === '/scan-request') {
                // Extension polls this to check for pending scan requests
                res.setHeader('Content-Type', 'application/json');
                res.writeHead(200);
                res.end(JSON.stringify(this.pendingScanRequest || {}));
            } else if (req.method === 'POST' && req.url === '/scan-response') {
                let body = '';
                req.on('data', chunk => body += chunk);
                req.on('end', () => {
                    try {
                        const data = JSON.parse(body);
                        const resolve = this.scanResolvers.get(data.requestId);
                        if (resolve) {
                            this.scanResolvers.delete(data.requestId);
                            this.pendingScanRequest = null;
                            // Update viewport bounds if present
                            if (data.vpLeft !== undefined) {
                                this.viewportBounds = {
                                    left: data.vpLeft, top: data.vpTop,
                                    right: data.vpRight, bottom: data.vpBottom
                                };
                            }
                            resolve(data);
                        }
                        res.writeHead(200);
                        res.end('OK');
                    } catch (e) {
                        res.writeHead(400);
                        res.end('Invalid JSON');
                    }
                });
            } else if (req.method === 'POST' && req.url === '/dom-change') {
                let body = '';
                req.on('data', chunk => body += chunk);
                req.on('end', () => {
                    try {
                        const data = JSON.parse(body);
                        const ts = new Date(data.timestamp).toLocaleTimeString();
                        if (data.type === 'textarea') {
                            console.log(`📝 [${ts}] DOM: [${data.questionLabel}] textarea len=${data.valueLength}`);
                        } else {
                            console.log(`📝 [${ts}] DOM: [${data.questionLabel}] ${data.type} → "${data.labelText}" checked=${data.checked}`);
                        }
                    } catch (_) {}
                    res.writeHead(200);
                    res.end('OK');
                });
            } else if (req.method === 'POST' && req.url === '/form-fields') {
                let body = '';
                req.on('data', chunk => body += chunk);
                req.on('end', () => {
                    try {
                        const data = JSON.parse(body);
                        this.handleFormFieldsDetected(data);
                        res.writeHead(200);
                        res.end('OK');
                    } catch (error) {
                        res.writeHead(400);
                        res.end('Invalid JSON');
                    }
                });
            } else if (req.method === 'GET' && req.url === '/status') {
                // Diagnostic endpoint — curl http://localhost:3004/status
                res.setHeader('Content-Type', 'application/json');
                res.writeHead(200);
                res.end(JSON.stringify({
                    currentPosition: this.currentPosition,
                    isReading: this.isReading,
                    isAutomating: this.isAutomating,
                    detectedFields: this.detectedFields
                        ? { url: this.detectedFields.url, fieldCount: this.detectedFields.fields.length,
                            fields: this.detectedFields.fields.map(f => ({ selector: f.selector, x: f.x, y: f.y, type: f.type })) }
                        : null
                }, null, 2));
            } else if (req.method === 'GET' && req.url === '/test-form') {
                const fs = require('fs');
                const path = require('path');
                const formPath = path.join(__dirname, 'test-form.html');
                fs.readFile(formPath, 'utf8', (err, html) => {
                    if (err) { res.writeHead(404); res.end('test-form.html not found'); return; }
                    res.setHeader('Content-Type', 'text/html');
                    res.writeHead(200);
                    res.end(html);
                });
            } else if (req.method === 'GET' && req.url === '/test-form2') {
                const fs = require('fs');
                const path = require('path');
                const formPath = path.join(__dirname, 'test-form2.html');
                fs.readFile(formPath, 'utf8', (err, html) => {
                    if (err) { res.writeHead(404); res.end('test-form2.html not found'); return; }
                    res.setHeader('Content-Type', 'text/html');
                    res.writeHead(200);
                    res.end(html);
                });
            } else if (req.method === 'GET' && req.url === '/current-form') {
                // Serve the most recently saved task HTML from the evaluator's current.json
                const fs = require('fs');
                const path = require('path');
                const currentJsonPath = path.join(__dirname, 'task-evaluator-v2 2', 'current.json');
                try {
                    const currentJson = JSON.parse(fs.readFileSync(currentJsonPath, 'utf8'));
                    const htmlPath = currentJson.file;
                    if (!htmlPath || !fs.existsSync(htmlPath)) {
                        res.writeHead(404); res.end('HTML file not found — check current.json .file path'); return;
                    }
                    fs.readFile(htmlPath, 'utf8', (err, html) => {
                        if (err) { res.writeHead(404); res.end('Could not read form HTML'); return; }
                        // Inject F-key trigger so it works even without the extension
                        const inject = `<script>
window.addEventListener('keydown', function(e) {
  if ((e.key === 'f' || e.key === 'F') && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA' && !document.activeElement.isContentEditable) {
    fetch('http://localhost:3004/start', { method: 'POST' }).catch(function(){});
  }
});
<\/script>`;
                        html = html.replace('</body>', inject + '</body>');
                        res.setHeader('Content-Type', 'text/html');
                        res.writeHead(200);
                        res.end(html);
                    });
                } catch (e) {
                    res.writeHead(500); res.end('current.json missing or invalid');
                }
            } else {
                res.writeHead(404);
                res.end();
            }
        });

        this.extensionServer.listen(3004, 'localhost', () => {
            console.log('🌐 Extension server listening on port 3004');
            console.log('📋 Test form: http://localhost:3004/test-form');
        });
    }
    
    
    async handleAutomationCommands(data) {
        // Handle different data formats from n8n vs direct calls
        let commands = [];
        
        if (Array.isArray(data)) {
            // n8n sends array directly
            commands = data;
        } else if (data.picoCommands && Array.isArray(data.picoCommands)) {
            // n8n workflow format
            commands = data.picoCommands;
        } else if (data.automationData && data.automationData.commands) {
            // Nested format
            commands = data.automationData.commands;
        } else {
            // Other formats
            commands = data.commands || [];
        }
        
        if (commands.length === 0) {
            console.log('⚠️  No automation commands received');
            return;
        }
        
        // Prevent reading session interruption during automation
        const wasReading = this.isReading;
        if (wasReading) {
            console.log('⏸️  Pausing reading session for automation');
            this.isReading = false;
        }
        
        this.isAutomating = true;

        // If the page provided the cursor position from the click event that
        // triggered automation, use it immediately — more reliable than waiting
        // for a mousemove update which may not fire if the cursor was stationary.
        if (typeof data.cursorX === 'number' && typeof data.cursorY === 'number') {
            this.currentPosition = { x: data.cursorX, y: data.cursorY };
            console.log(`📍 Cursor at (${data.cursorX}, ${data.cursorY}) from click event`);
        }

        console.log(`🤖 Received ${commands.length} automation commands`);
        
        for (let i = 0; i < commands.length; i++) {
            if (this.emergencyStop) break;
            
            const command = commands[i];
            
            // Skip problematic Enter key that causes macOS shortcuts
            if (command === 'KEY,Enter') {
                console.log(`📝 Skipping: ${command} (blocked to prevent macOS shortcuts)`);
                continue;
            }
            
            // Log coordinates for debugging
            if (command.startsWith('MOVE,')) {
                const coords = command.split(',');
                const x = parseInt(coords[1]);
                const y = parseInt(coords[2]);
                console.log(`🎯 Moving to coordinates: (${x}, ${y})`);
            }
            
            console.log(`📝 Executing: ${command}`);
            
            // Handle DELAY commands locally, don't send to Pico
            if (command.startsWith('DELAY,')) {
                const delayMs = parseInt(command.split(',')[1]);
                console.log(`   ⏳ Local delay: ${delayMs}ms`);
                await new Promise(resolve => setTimeout(resolve, delayMs));

            // FILL_FIELD,selector,text — live coord lookup + move + click + type
            // Strict verify-before-proceed: will not advance until the field
            // is confirmed in-view, focused, and contains the expected value.
            } else if (command.startsWith('FILL_FIELD,')) {
                const parts = command.split(',');
                const selector = parts[1];
                const text = parts.slice(2).join(',');
                console.log(`📝 FILL_FIELD: "${selector}" → "${text}"`);
                const MAX_RETRIES = 4;
                let filled = false;
                for (let attempt = 0; attempt < MAX_RETRIES && !filled; attempt++) {
                    if (this.emergencyStop) break;
                    try {
                        // 1. Get live coords
                        let coords = await this.getLiveCoords(selector);
                        if (!coords.found) throw new Error('Element not found');

                        // 2. Scroll into view if needed — loop until confirmed in viewport
                        if (!coords.inViewport) {
                            coords = await this.scrollToElement(selector);
                            if (!coords.found) throw new Error('Element lost during scroll');
                        }
                        // Double-check it's really in view
                        coords = await this.getLiveCoords(selector);
                        if (!coords.found) throw new Error('Element not found after scroll');
                        if (!coords.inViewport) {
                            console.log(`   ⚠️  still not in viewport after scroll (attempt ${attempt + 1})`);
                            continue; // retry from top
                        }

                        const cursorStart = (typeof coords.cursorX === 'number') ? { x: coords.cursorX, y: coords.cursorY } : null;

                        // 3. Move and click
                        await this.moveToAbs(coords.x, coords.y, cursorStart);
                        await this.sendCommand('CLICK');
                        await new Promise(r => setTimeout(r, 250));

                        // 4. Verify focus — retry click if not focused
                        let focusCheck = await this.getLiveCoords(selector);
                        if (focusCheck.found && !focusCheck.focused) {
                            console.log(`   ⚠️  not focused — retrying click (attempt ${attempt + 1})`);
                            const cs = (typeof focusCheck.cursorX === 'number') ? { x: focusCheck.cursorX, y: focusCheck.cursorY } : null;
                            await this.moveToAbs(focusCheck.x, focusCheck.y, cs);
                            await this.sendCommand('CLICK');
                            await new Promise(r => setTimeout(r, 250));
                            focusCheck = await this.getLiveCoords(selector);
                            if (focusCheck.found && !focusCheck.focused) {
                                console.log(`   ⚠️  still not focused after retry`);
                                continue; // retry from top
                            }
                        }

                        // 5. Clear existing text and type new text
                        // Select all first to replace any existing content
                        await this.sendCommand('COMBO,ctrl+a');
                        await new Promise(r => setTimeout(r, 100));
                        for (const char of text) {
                            await this.sendCommand(`TYPE,${char}`);
                            await new Promise(resolve => setTimeout(resolve, 60 + Math.random() * 40));
                        }
                        await new Promise(r => setTimeout(r, 200));

                        // 6. Verify the value was set
                        const afterType = await this.getLiveCoords(selector);
                        if (afterType.found && afterType.value) {
                            // Check if at least the start of the text matches
                            const got = afterType.value.trim().toLowerCase();
                            const want = text.trim().toLowerCase();
                            if (got.startsWith(want.substring(0, 20)) || want.startsWith(got.substring(0, 20))) {
                                console.log(`   ✅ value confirmed (${afterType.value.length} chars)`);
                                filled = true;
                            } else {
                                console.log(`   ⚠️  value mismatch — got "${got.substring(0, 40)}..." (attempt ${attempt + 1})`);
                            }
                        } else {
                            console.log(`   ⚠️  could not read value back (attempt ${attempt + 1})`);
                            // Don't assume success — retry
                        }
                    } catch (err) {
                        console.error(`   ❌ FILL_FIELD attempt ${attempt + 1} failed: ${err.message}`);
                        await new Promise(r => setTimeout(r, 500));
                    }
                }
                if (!filled) {
                    console.error(`   ❌ FILL_FIELD FAILED after ${MAX_RETRIES} attempts: "${selector}"`);
                    console.error(`   🛑 HALTING automation — cannot proceed with unverified state`);
                    this.isAutomating = false;
                    return; // STOP — do not advance to next command
                }

            // CLICK_SELECTOR,selector — live coord lookup + move + click
            // Strict verify-before-proceed for checkboxes.
            } else if (command.startsWith('CLICK_SELECTOR,')) {
                const selector = command.split(',').slice(1).join(',');
                console.log(`🖱️  CLICK_SELECTOR: "${selector}"`);
                const MAX_RETRIES = 4;
                let confirmed = false;
                for (let attempt = 0; attempt < MAX_RETRIES && !confirmed; attempt++) {
                    if (this.emergencyStop) break;
                    try {
                        let coords = await this.getLiveCoords(selector);
                        if (!coords.found) throw new Error('Element not found');
                        const prevChecked = coords.checked;

                        if (!coords.inViewport) {
                            coords = await this.scrollToElement(selector);
                            if (!coords.found) throw new Error('Element lost during scroll');
                        }
                        // Confirm in view
                        coords = await this.getLiveCoords(selector);
                        if (!coords.found) throw new Error('Element not found after scroll');
                        if (!coords.inViewport) {
                            console.log(`   ⚠️  still not in viewport (attempt ${attempt + 1})`);
                            continue;
                        }

                        const cursorStart = (typeof coords.cursorX === 'number') ? { x: coords.cursorX, y: coords.cursorY } : null;
                        await this.moveToAbs(coords.x, coords.y, cursorStart);
                        await this.sendCommand('CLICK');
                        await new Promise(r => setTimeout(r, 200));

                        // Verify for checkboxes
                        if (prevChecked !== null) {
                            const check = await this.getLiveCoords(selector);
                            if (check.found && check.checked !== prevChecked) {
                                console.log(`   ✅ checkbox → ${check.checked}`);
                                confirmed = true;
                            } else if (check.found) {
                                console.log(`   ⚠️  checkbox unchanged (attempt ${attempt + 1})`);
                            }
                        } else {
                            console.log(`   ✅ clicked`);
                            confirmed = true;
                        }
                    } catch (err) {
                        console.error(`   ❌ CLICK_SELECTOR attempt ${attempt + 1} failed: ${err.message}`);
                        await new Promise(r => setTimeout(r, 500));
                    }
                }
                if (!confirmed) {
                    console.error(`   ❌ CLICK_SELECTOR FAILED after ${MAX_RETRIES} attempts: "${selector}"`);
                    console.error(`   🛑 HALTING automation — cannot proceed with unverified state`);
                    this.isAutomating = false;
                    return;
                }

            // CLICK_OPTION,#question-N,label text — finds radio/checkbox by label text
            // Strict verify-before-proceed: will not advance until the option's
            // checked state has actually changed in the DOM.
            } else if (command.startsWith('CLICK_OPTION,')) {
                const parts = command.split(',');
                const containerSelector = parts[1];
                const labelText = parts.slice(2).join(',');
                console.log(`🖱️  CLICK_OPTION: "${containerSelector}" → "${labelText}"`);

                // Pre-check: if the target option is ALREADY checked, skip it
                try {
                    const preCheck = await this.getLiveCoords(containerSelector, { labelText });
                    if (preCheck.found && preCheck.checked === true) {
                        console.log(`   ✅ already checked — skipping`);
                        continue; // next command in the queue
                    }
                } catch (_) {} // if pre-check fails, proceed with normal retry loop

                const MAX_RETRIES = 6;
                let confirmed = false;
                for (let attempt = 0; attempt < MAX_RETRIES && !confirmed; attempt++) {
                    if (this.emergencyStop) break;
                    try {
                        // 1. Get live coords for this label within the container
                        let coords = await this.getLiveCoords(containerSelector, { labelText });
                        if (!coords.found) throw new Error(`Label "${labelText}" not found in ${containerSelector}`);

                        const prevChecked = coords.checked;

                        // 2. Scroll into view — loop until confirmed in viewport
                        if (!coords.inViewport) {
                            coords = await this.scrollToElement(containerSelector, { labelText });
                            if (!coords.found) throw new Error('Element lost during scroll');
                        }
                        // Double-check it's in view
                        coords = await this.getLiveCoords(containerSelector, { labelText });
                        if (!coords.found) throw new Error('Element not found after scroll');
                        if (!coords.inViewport) {
                            console.log(`   ⚠️  still not in viewport (attempt ${attempt + 1})`);
                            continue;
                        }

                        // 3. Move and click
                        const cursorStart = (typeof coords.cursorX === 'number') ? { x: coords.cursorX, y: coords.cursorY } : null;
                        console.log(`   → move to (${Math.round(coords.x)}, ${Math.round(coords.y)}) [attempt ${attempt + 1}]`);
                        await this.moveToAbs(coords.x, coords.y, cursorStart);
                        await this.sendCommand('CLICK');
                        await new Promise(r => setTimeout(r, 500)); // 500ms settle for React re-render

                        // 4. Verify state changed
                        const check = await this.getLiveCoords(containerSelector, { labelText });
                        if (!check.found) {
                            console.log(`   ⚠️  element not found for verify — DOM may be re-rendering (attempt ${attempt + 1})`);
                            await new Promise(r => setTimeout(r, 500)); // extra wait for DOM settle
                            continue;
                        }

                        if (check.checked !== null) {
                            // Radio/checkbox — checked state should have changed
                            if (check.checked === true) {
                                console.log(`   ✅ confirmed checked`);
                                confirmed = true;
                            } else if (check.checked === prevChecked) {
                                console.log(`   ⚠️  state unchanged (still ${check.checked}) — retrying (attempt ${attempt + 1})`);
                                // Try clicking with slightly offset coords in case we missed
                                await new Promise(r => setTimeout(r, 200));
                            } else {
                                console.log(`   ✅ state changed → ${check.checked}`);
                                confirmed = true;
                            }
                        } else {
                            // No checked state to verify (might be a custom element)
                            console.log(`   ✅ clicked (no checked state to verify)`);
                            confirmed = true;
                        }
                    } catch (err) {
                        console.error(`   ❌ CLICK_OPTION attempt ${attempt + 1} failed: ${err.message}`);
                        await new Promise(r => setTimeout(r, 500));
                    }
                }
                if (!confirmed) {
                    console.error(`   ❌ CLICK_OPTION FAILED after ${MAX_RETRIES} attempts: "${containerSelector}" → "${labelText}"`);
                    console.error(`   🛑 HALTING automation — cannot proceed with unverified state`);
                    this.isAutomating = false;
                    return; // STOP — do not advance to next command
                }

            } else {
                // Send other commands to Pico
                await this.sendCommand(command);
            }
            
            // Small delay between commands
            await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 200));
        }
        
        this.isAutomating = false;
        console.log('✅ Automation commands completed');
        
        // Resume reading session if it was active
        if (wasReading && !this.emergencyStop) {
            console.log('▶️  Resuming reading session');
            this.isReading = true;
            this.scheduleNextScroll();
            this.scheduleNextMouseMovement();
        }
    }
    
    handleFormFieldsDetected(data) {
        if (data.type === 'FORM_FIELDS_DETECTED') {
            const fields = data.fields || [];
            console.log(`📋 Form fields detected: ${fields.length} fields on ${data.url}`);
            
            // Store fields for potential automation
            this.detectedFields = {
                url: data.url,
                fields: fields,
                timestamp: Date.now()
            };
            
            // Send to n8n workflow if configured
            this.sendToN8N(this.detectedFields);
        }
    }
    
    sendToN8N(formData) {
        // Send detected form fields to n8n for processing
        const http = require('http');
        const postData = JSON.stringify(formData);
        
        const options = {
            hostname: 'localhost',
            port: 5678,
            path: '/webhook-test/form-automation',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            }
        };
        
        const req = http.request(options, (res) => {
            if (res.statusCode === 200) {
                console.log('📡 Form data sent to n8n workflow');
            }
        });
        
        req.on('error', () => {
            // Silent fail - n8n might not be running
        });
        
        req.write(postData);
        req.end();
    }
    
    setPosition(x, y) {
        this.currentPosition = { x, y };
    }
}

async function startReadingSimulator() {
    console.log('🔍 Looking for Pico...');
    
    // Auto-detect Pico port
    let portPath = '/dev/tty.usbmodem2101';
    try {
        const ports = await SerialPort.list();
        const picoPort = ports.find(port => 
            port.manufacturer && port.manufacturer.includes('Raspberry Pi')
        );
        if (picoPort) {
            portPath = picoPort.path;
        }
    } catch (error) {
        console.log('⚠️  Using default port');
    }
    
    console.log(`🔗 Connecting to Pico on ${portPath}...`);
    
    const simulator = new ReadingBehaviorSimulator(portPath);
    
    // Set initial cursor position (center of screen)
    await new Promise(resolve => setTimeout(resolve, 2000));
    simulator.setPosition(640, 400);
    
    console.log('🎮 Ready! Simulator is waiting for your input...');
}

startReadingSimulator().catch(console.error);