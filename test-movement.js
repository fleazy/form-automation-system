#!/usr/bin/env node
/**
 * test-movement.js — minimal movement-only server for diagnosing cursor accuracy.
 *
 * No reading simulation, no scrolling, no auto-start.
 * Just connects to the Pico, starts the HTTP server on port 3004,
 * and handles movement/automation endpoints.
 *
 * Usage:
 *   node test-movement.js
 *
 * Then open http://localhost:3004/test-form in Chrome (with extension active).
 * Use the test buttons or curl to trigger movements.
 *
 * Diagnostic endpoints:
 *   curl http://localhost:3004/status
 *   curl -X POST http://localhost:3004/test-move \
 *     -H "Content-Type: application/json" \
 *     -d '{"delay":4000,"moves":[[883,546]],"cursorX":615,"cursorY":546}'
 */

const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');
const http = require('http');
const fs = require('fs');
const path = require('path');

class MovementTester {
    constructor(portPath) {
        this.currentPosition = { x: 640, y: 400 };
        this.currentHovered = { id: '', name: '' };
        this.emergencyStop = false;
        this.pendingCoordRequest = null;
        this.coordResolvers = new Map();
        this.detectedFields = null;

        console.log(`🔗 Connecting to Pico on ${portPath}...`);
        this.port = new SerialPort({ path: portPath, baudRate: 115200 });
        this.port.on('error', err => console.error('Serial port error:', err.message));

        const parser = this.port.pipe(new ReadlineParser({ delimiter: '\n' }));
        parser.on('data', data => console.log(`📥 Pico: ${data.trim()}`));

        process.on('SIGINT', () => {
            console.log('\n🛑 Stopping...');
            this.emergencyStop = true;
            this.port.close();
            process.exit(0);
        });

        this.startServer();
        console.log('✅ Movement tester ready — no reading simulation running');
    }

    // ─── Core movement ────────────────────────────────────────────────────────
    // Extension gives us exact target + cursor coords. We just step linearly
    // toward the target in small increments to avoid OS pointer acceleration.
    // Correction pass handles any residual drift after the move settles.

    async moveToAbs(targetX, targetY, startPos = null) {
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

        const STEP = 15; // px per step — no pointer acceleration, so go fast
        const steps = Math.ceil(dist / STEP);
        let sentX = 0, sentY = 0;

        for (let i = 1; i <= steps; i++) {
            if (this.emergencyStop) break;
            const wantX = Math.round(dx * i / steps);
            const wantY = Math.round(dy * i / steps);
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

        // Brief settle so mousemove events report back the landing position
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

    // ─── Hover verification ───────────────────────────────────────────────────

    isHoveringSelector(selector) {
        const { id, name } = this.currentHovered;
        if (selector.startsWith('#')) return id === selector.slice(1);
        const m = selector.match(/\[name="([^"]+)"\]/);
        if (m) return name === m[1];
        return false;
    }

    // Poll until the cursor is over `selector` or `timeout`ms elapses.
    // Needed because the hover POST arrives asynchronously — checking instantly
    // after moveToAbs risks reading stale state.
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

    // ─── Live coord lookup ────────────────────────────────────────────────────

    getLiveCoords(selector, { labelText } = {}) {
        return new Promise((resolve, reject) => {
            const requestId = Date.now().toString();
            this.pendingCoordRequest = { requestId, selector, ...(labelText ? { labelText } : {}) };
            this.coordResolvers.set(requestId, resolve);
            setTimeout(() => {
                if (this.coordResolvers.has(requestId)) {
                    this.coordResolvers.delete(requestId);
                    this.pendingCoordRequest = null;
                    reject(new Error(`Timeout waiting for coords: ${selector}${labelText ? ' | ' + labelText : ''}`));
                }
            }, 5000);
        });
    }

    // ─── HTTP server ─────────────────────────────────────────────────────────

    startServer() {
        const server = http.createServer((req, res) => {
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
            if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

            // ── GET /status ──────────────────────────────────────────────────
            if (req.method === 'GET' && req.url === '/status') {
                res.setHeader('Content-Type', 'application/json');
                res.writeHead(200);
                res.end(JSON.stringify({
                    currentPosition: this.currentPosition,
                    detectedFields: this.detectedFields
                        ? {
                            url: this.detectedFields.url,
                            fieldCount: this.detectedFields.fields.length,
                            fields: this.detectedFields.fields.map(f => ({
                                selector: f.selector, type: f.type,
                                x: f.x, y: f.y
                            }))
                        }
                        : null
                }, null, 2));
                return;
            }

            // ── GET /test-form ────────────────────────────────────────────────
            if (req.method === 'GET' && req.url === '/test-form') {
                const formPath = path.join(__dirname, 'test-form.html');
                fs.readFile(formPath, 'utf8', (err, html) => {
                    if (err) { res.writeHead(404); res.end('test-form.html not found'); return; }
                    res.setHeader('Content-Type', 'text/html');
                    res.writeHead(200);
                    res.end(html);
                });
                return;
            }

            // ── GET /test-form2 ───────────────────────────────────────────────
            if (req.method === 'GET' && req.url === '/test-form2') {
                const formPath = path.join(__dirname, 'test-form2.html');
                fs.readFile(formPath, 'utf8', (err, html) => {
                    if (err) { res.writeHead(404); res.end('test-form2.html not found'); return; }
                    res.setHeader('Content-Type', 'text/html');
                    res.writeHead(200);
                    res.end(html);
                });
                return;
            }

            // ── GET /coord-request ────────────────────────────────────────────
            if (req.method === 'GET' && req.url === '/coord-request') {
                res.setHeader('Content-Type', 'application/json');
                res.writeHead(200);
                res.end(JSON.stringify(this.pendingCoordRequest || {}));
                return;
            }

            // All remaining routes have a POST body
            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', async () => {
                let data = {};
                try { data = JSON.parse(body); } catch (_) {}

                // ── POST /cursor-position ─────────────────────────────────────
                if (req.url === '/cursor-position') {
                    if (typeof data.x === 'number') {
                        this.currentPosition = { x: data.x, y: data.y };
                        this.currentHovered = { id: data.hoveredId || '', name: data.hoveredName || '' };
                    }
                    res.writeHead(200); res.end('OK'); return;
                }

                // ── POST /cursor-hover ────────────────────────────────────────
                // Hover-only update — never touches currentPosition so stale
                // liveCursorX/Y in the extension can't corrupt our position estimate.
                if (req.url === '/cursor-hover') {
                    this.currentHovered = { id: data.hoveredId || '', name: data.hoveredName || '' };
                    res.writeHead(200); res.end('OK'); return;
                }

                // ── POST /coord-response ──────────────────────────────────────
                if (req.url === '/coord-response') {
                    const resolve = this.coordResolvers.get(data.requestId);
                    if (resolve) {
                        this.coordResolvers.delete(data.requestId);
                        this.pendingCoordRequest = null;
                        resolve(data);
                    }
                    res.writeHead(200); res.end('OK'); return;
                }

                // ── POST /form-fields ─────────────────────────────────────────
                if (req.url === '/form-fields') {
                    if (data.type === 'FORM_FIELDS_DETECTED') {
                        this.detectedFields = { url: data.url, fields: data.fields || [], timestamp: Date.now() };
                        console.log(`📋 ${data.fields.length} fields detected on ${data.url}`);
                        data.fields.forEach(f => console.log(`   ${f.selector.padEnd(30)} (${f.x}, ${f.y})`));
                    }
                    res.writeHead(200); res.end('OK'); return;
                }

                // ── POST /bottom-reached ──────────────────────────────────────
                if (req.url === '/bottom-reached') {
                    res.writeHead(200); res.end('OK'); return;
                }

                // ── POST /test-move ───────────────────────────────────────────
                if (req.url === '/test-move') {
                    const delay = data.delay ?? 4000;
                    const moves = data.moves ?? [];
                    const clickCursor = (typeof data.cursorX === 'number')
                        ? { x: data.cursorX, y: data.cursorY } : null;
                    if (clickCursor) {
                        this.currentPosition = { ...clickCursor };
                        console.log(`📍 Cursor at (${clickCursor.x}, ${clickCursor.y}) from request`);
                    }
                    res.writeHead(200);
                    res.end(`OK — moving in ${delay}ms`);
                    (async () => {
                        console.log(`⏳ Waiting ${delay}ms before moving...`);
                        await new Promise(r => setTimeout(r, delay));
                        let startPos = clickCursor;
                        for (const [x, y] of moves) {
                            await this.moveToAbs(x, y, startPos);
                            startPos = null;
                            await new Promise(r => setTimeout(r, 400));
                        }
                        console.log('✅ Test move done');
                    })();
                    return;
                }

                // ── POST /automation ──────────────────────────────────────────
                if (req.url === '/automation') {
                    const commands = data.commands || [];
                    if (typeof data.cursorX === 'number') {
                        this.currentPosition = { x: data.cursorX, y: data.cursorY };
                        console.log(`📍 Cursor at (${data.cursorX}, ${data.cursorY}) from request`);
                    }
                    res.writeHead(200); res.end('OK');
                    (async () => {
                        console.log(`🤖 ${commands.length} commands`);
                        for (const cmd of commands) {
                            if (this.emergencyStop) break;
                            console.log(`▶  ${cmd}`);

                            if (cmd.startsWith('FILL_FIELD,')) {
                                const parts = cmd.split(',');
                                const selector = parts[1];
                                const text = parts.slice(2).join(',');
                                try {
                                    // 1. Get live coords + current DOM state
                                    const coords = await this.getLiveCoords(selector);
                                    if (!coords.found) throw new Error('element not found');
                                    const cursorStart = (typeof coords.cursorX === 'number')
                                        ? { x: coords.cursorX, y: coords.cursorY } : null;

                                    // 2. Move and click
                                    await this.moveToAbs(coords.x, coords.y, cursorStart);
                                    this.port.write('CLICK\r\n');
                                    await new Promise(r => setTimeout(r, 200));

                                    // 3. Verify focus via DOM (document.activeElement === el)
                                    //    Retry once with fresh coords if click missed
                                    try {
                                        const afterClick = await this.getLiveCoords(selector);
                                        if (afterClick.found && !afterClick.focused) {
                                            console.log(`   ⚠️  not focused after click — re-centering and retrying`);
                                            const cs = (typeof afterClick.cursorX === 'number')
                                                ? { x: afterClick.cursorX, y: afterClick.cursorY } : null;
                                            await this.moveToAbs(afterClick.x, afterClick.y, cs);
                                            this.port.write('CLICK\r\n');
                                            await new Promise(r => setTimeout(r, 150));
                                        } else if (afterClick.focused) {
                                            console.log(`   ✅ field focused`);
                                        }
                                    } catch (_) {
                                        console.log(`   ⚠️  focus check timed out — continuing`);
                                    }

                                    // 4. Type text
                                    for (const char of text) {
                                        this.port.write(`TYPE,${char}\r\n`);
                                        await new Promise(r => setTimeout(r, 60 + Math.random() * 40));
                                    }

                                    // 5. Verify value via DOM (best-effort, non-blocking)
                                    try {
                                        const afterType = await this.getLiveCoords(selector);
                                        if (afterType.found) {
                                            console.log(`   ${afterType.value ? '✅' : '⚠️ '} value: "${afterType.value}"`);
                                        }
                                    } catch (_) {}
                                } catch (err) {
                                    console.error(`   ❌ ${err.message}`);
                                }

                            } else if (cmd.startsWith('CLICK_SELECTOR,')) {
                                const selector = cmd.split(',').slice(1).join(',');
                                try {
                                    // 1. Get live coords + current DOM state
                                    const coords = await this.getLiveCoords(selector);
                                    if (!coords.found) throw new Error('element not found');
                                    const cursorStart = (typeof coords.cursorX === 'number')
                                        ? { x: coords.cursorX, y: coords.cursorY } : null;

                                    // 2. Move and click
                                    await this.moveToAbs(coords.x, coords.y, cursorStart);
                                    this.port.write('CLICK\r\n');
                                    await new Promise(r => setTimeout(r, 200));

                                    // 3. Verify via DOM state — for checkboxes check el.checked toggled
                                    if (coords.checked !== null) {
                                        try {
                                            const check = await this.getLiveCoords(selector);
                                            if (check.found && check.checked === coords.checked) {
                                                console.log(`   ⚠️  checkbox unchanged — re-centering and retrying`);
                                                const cs = (typeof check.cursorX === 'number')
                                                    ? { x: check.cursorX, y: check.cursorY } : null;
                                                await this.moveToAbs(check.x, check.y, cs);
                                                this.port.write('CLICK\r\n');
                                                await new Promise(r => setTimeout(r, 150));
                                            } else if (check.found) {
                                                console.log(`   ✅ checkbox → ${check.checked}`);
                                            }
                                        } catch (_) {
                                            console.log(`   ⚠️  checkbox verify timed out`);
                                        }
                                    }
                                } catch (err) {
                                    console.error(`   ❌ ${err.message}`);
                                }

                            } else if (cmd.startsWith('CLICK_OPTION,')) {
                                const parts = cmd.split(',');
                                const containerSelector = parts[1];
                                const labelText = parts.slice(2).join(',');
                                console.log(`🖱️  CLICK_OPTION: "${containerSelector}" → "${labelText}"`);
                                try {
                                    const coords = await this.getLiveCoords(containerSelector, { labelText });
                                    if (!coords.found) throw new Error(`Label "${labelText}" not found`);
                                    const cursorStart = (typeof coords.cursorX === 'number')
                                        ? { x: coords.cursorX, y: coords.cursorY } : null;
                                    await this.moveToAbs(coords.x, coords.y, cursorStart);
                                    this.port.write('CLICK\r\n');
                                    await new Promise(r => setTimeout(r, 200));
                                    if (coords.checked !== null) {
                                        try {
                                            const check = await this.getLiveCoords(containerSelector, { labelText });
                                            if (check.found && check.checked === coords.checked) {
                                                console.log(`   ⚠️  state unchanged — retrying`);
                                                const cs = (typeof check.cursorX === 'number')
                                                    ? { x: check.cursorX, y: check.cursorY } : null;
                                                await this.moveToAbs(check.x, check.y, cs);
                                                this.port.write('CLICK\r\n');
                                                await new Promise(r => setTimeout(r, 150));
                                            } else if (check.found) {
                                                console.log(`   ✅ checked → ${check.checked}`);
                                            }
                                        } catch (_) { console.log(`   ⚠️  verify timed out`); }
                                    } else {
                                        console.log(`   ✅ clicked`);
                                    }
                                } catch (err) {
                                    console.error(`   ❌ CLICK_OPTION failed: ${err.message}`);
                                }

                            } else if (cmd.startsWith('DELAY,')) {
                                await new Promise(r => setTimeout(r, parseInt(cmd.split(',')[1])));

                            } else {
                                this.port.write(cmd + '\r\n');
                            }

                            await new Promise(r => setTimeout(r, 100 + Math.random() * 150));
                        }
                        console.log('✅ Done');
                    })();
                    return;
                }

                res.writeHead(404); res.end();
            });
        });

        server.listen(3004, 'localhost', () => {
            console.log('🌐 Server on http://localhost:3004');
            console.log('   Test form  : http://localhost:3004/test-form');
            console.log('   Test form 2: http://localhost:3004/test-form2');
            console.log('   Status    : curl http://localhost:3004/status');
            console.log('   Move test : curl -X POST http://localhost:3004/test-move \\');
            console.log('               -H "Content-Type: application/json" \\');
            console.log('               -d \'{"delay":4000,"moves":[[X,Y]],"cursorX":CX,"cursorY":CY}\'');
        });
    }
}

// ─── Auto-detect Pico and start ───────────────────────────────────────────────

(async () => {
    let portPath = '/dev/tty.usbmodem2101';
    try {
        const ports = await SerialPort.list();
        const pico = ports.find(p => p.manufacturer && p.manufacturer.includes('Raspberry Pi'));
        if (pico) portPath = pico.path;
        else console.log('⚠️  Raspberry Pi not found in port list — using default path');
    } catch (_) {}

    new MovementTester(portPath);
})();
