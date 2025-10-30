const express = require('express');
const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');
const cors = require('cors');

class EnhancedGhostCursorService {
  constructor() {
    this.app = express();
    this.app.use(cors());
    this.app.use(express.json({ limit: '10mb' }));
    
    this.picoController = null;
    this.isExecuting = false;
    
    this.setupRoutes();
    this.initializePico();
    
    console.log('🚀 Enhanced Ghost Cursor Service starting...');
  }
  
  async initializePico() {
    try {
      const portPath = await this.findPicoPort();
      this.picoController = new EnhancedGhostCursor(portPath);
      console.log(`✅ Connected to Pico on ${portPath}`);
    } catch (error) {
      console.error('❌ Failed to connect to Pico:', error.message);
    }
  }
  
  async findPicoPort() {
    const ports = await SerialPort.list();
    const picoPort = ports.find(port => 
      port.manufacturer && port.manufacturer.includes('Raspberry Pi')
    );
    return picoPort ? picoPort.path : '/dev/tty.usbmodem1101';
  }
  
  setupRoutes() {
    // Health check
    this.app.get('/health', (req, res) => {
      res.json({ 
        status: 'ok', 
        executing: this.isExecuting,
        picoConnected: !!this.picoController 
      });
    });
    
    // Execute browsing actions (Phase 1 - while AI thinks)
    this.app.post('/execute-browsing', async (req, res) => {
      const { actions, phase } = req.body;
      
      console.log(`🌐 Starting browsing phase: ${actions.length} actions`);
      
      if (this.isExecuting) {
        return res.status(429).json({ error: 'Already executing automation' });
      }
      
      if (!this.picoController) {
        return res.status(503).json({ error: 'Pico not connected' });
      }
      
      try {
        this.isExecuting = true;
        const results = await this.executeActions(actions);
        this.isExecuting = false;
        
        res.json({
          success: true,
          phase: 'browsing_complete',
          actionsExecuted: actions.length,
          results: results,
          message: 'Human-like browsing completed while AI processed'
        });
      } catch (error) {
        this.isExecuting = false;
        console.error('Browsing execution error:', error);
        res.status(500).json({ error: error.message });
      }
    });
    
    // Test form completion on offline page
    this.app.post('/test-offline', async (req, res) => {
      const { actions, mode } = req.body;
      
      console.log(`🧪 Testing form completion offline: ${actions.length} actions`);
      console.log('📋 MANUAL STEP: Please navigate to the OFFLINE page in your browser');
      console.log('⏳ Waiting 10 seconds for you to switch to offline page...');
      
      try {
        // Give user time to switch to offline page
        await new Promise(resolve => setTimeout(resolve, 10000));
        
        console.log('🎯 Starting offline test execution...');
        this.isExecuting = true;
        
        const results = await this.executeFormActions(actions, 'offline');
        this.isExecuting = false;
        
        console.log('✅ Offline test completed');
        
        res.json({
          success: true,
          mode: 'offline_test',
          testResults: results,
          readyForLive: results.every(r => r.success),
          message: 'Offline form completion test complete',
          nextStep: 'Navigate to LIVE page when ready for live execution'
        });
      } catch (error) {
        this.isExecuting = false;
        console.error('❌ Offline test failed:', error);
        res.status(500).json({ 
          success: false, 
          error: error.message,
          mode: 'offline_test'
        });
      }
    });

    // Execute final form completion on live page
    this.app.post('/execute-form-completion', async (req, res) => {
      const { actions, mode } = req.body;
      
      console.log(`✅ Executing form completion live: ${actions.length} actions`);
      console.log('📋 MANUAL STEP: Please navigate to the LIVE page in your browser');
      console.log('⏳ Waiting 10 seconds for you to switch to live page...');
      
      try {
        // Give user time to switch to live page
        await new Promise(resolve => setTimeout(resolve, 10000));
        
        console.log('🎯 Starting live execution...');
        this.isExecuting = true;
        
        const results = await this.executeFormActions(actions, 'live');
        this.isExecuting = false;
        
        console.log('🎉 Live form completion executed successfully!');
        
        res.json({
          success: true,
          mode: 'live_execution',
          formCompleted: true,
          results: results,
          message: 'Form completion executed successfully!'
        });
      } catch (error) {
        this.isExecuting = false;
        console.error('❌ Live execution failed:', error);
        res.status(500).json({ error: error.message });
      }
    });
    
    // Emergency stop
    this.app.post('/stop', (req, res) => {
      if (this.picoController) {
        this.picoController.emergencyStop = true;
      }
      this.isExecuting = false;
      res.json({ stopped: true });
    });
  }
  
  async executeActions(actions) {
    console.log(`🚀 Starting Ghost Cursor execution: ${actions.length} actions`);
    
    const results = [];
    
    for (const [index, action] of actions.entries()) {
      if (this.picoController.emergencyStop) {
        console.log('🛑 Emergency stop triggered');
        break;
      }
      
      console.log(`Action ${index + 1}/${actions.length}: ${action.type}`);
      
      try {
        const actionResult = await this.picoController.executeAction(action);
        results.push({ 
          action: action.type, 
          success: true, 
          result: actionResult 
        });
      } catch (error) {
        console.error(`Failed to execute action ${index + 1}:`, error);
        results.push({ 
          action: action.type, 
          success: false, 
          error: error.message 
        });
      }
    }
    
    return results;
  }
  
  async executeFormActions(actions, mode) {
    const results = [];
    
    console.log(`🎬 Executing ${actions.length} form actions in ${mode} mode`);
    
    for (const [index, action] of actions.entries()) {
      if (this.picoController.emergencyStop) break;
      
      console.log(`📝 Action ${index + 1}/${actions.length}: ${action.type} ${action.description || ''}`);
      
      try {
        let result;
        switch (action.type) {
          case 'click':
            result = await this.picoController.humanizedClick(action);
            console.log(`   ✅ Clicked at (${action.x}, ${action.y})`);
            break;
          case 'type':
            result = await this.picoController.humanizedType(action);
            console.log(`   ✅ Typed: "${action.text}"`);
            break;
          case 'scroll':
            result = await this.picoController.humanizedScroll(action);
            console.log(`   ✅ Scrolled ${action.direction}`);
            break;
          case 'delay':
            result = await this.picoController.humanDelay(action.duration);
            console.log(`   ⏳ Delayed ${action.duration}ms`);
            break;
          default:
            console.warn(`   ⚠️  Unknown action: ${action.type}`);
            result = { skipped: true, reason: 'unknown_action_type' };
        }
        
        results.push({ 
          action: action.type, 
          success: true, 
          result,
          description: action.description 
        });
        
        // Small delay between actions for natural flow
        await new Promise(resolve => setTimeout(resolve, 200 + Math.random() * 300));
        
      } catch (error) {
        console.error(`   ❌ Failed: ${error.message}`);
        results.push({ 
          action: action.type, 
          success: false, 
          error: error.message,
          description: action.description 
        });
      }
    }
    
    const successCount = results.filter(r => r.success).length;
    console.log(`📊 Form execution complete: ${successCount}/${results.length} actions succeeded`);
    
    return results;
  }
  
  start(port = 3001) {
    this.app.listen(port, () => {
      console.log(`🌟 Ghost Cursor Service running on http://localhost:${port}`);
      console.log(`📡 Ready to receive actions from n8n`);
    });
  }
}

class EnhancedGhostCursor {
  constructor(portPath) {
    this.port = new SerialPort({ path: portPath, baudRate: 115200 });
    this.parser = this.port.pipe(new ReadlineParser({ delimiter: '\n' }));
    this.commandQueue = [];
    this.isProcessing = false;
    this.currentPosition = { x: 400, y: 300 };
    this.emergencyStop = false;
    
    this.parser.on('data', (data) => {
      if (data.trim() === 'OK') this.processNextCommand();
    });
    
    // Wait for connection
    setTimeout(() => {
      console.log('🎮 Pico controller ready for humanized actions');
    }, 2000);
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
    setTimeout(resolve, 15);
  }
  
  async executeAction(action) {
    if (this.emergencyStop) return { stopped: true };
    
    console.log(`🎬 Executing: ${action.type} with humanization`);
    
    switch (action.type) {
      case 'click':
        return await this.humanizedClick(action);
      case 'scroll':
        return await this.humanizedScroll(action);
      case 'delay':
        return await this.humanDelay(action.duration);
      default:
        console.warn(`Unknown action type: ${action.type}`);
        return { skipped: true };
    }
  }
  
  async humanizedClick(action) {
    // ALWAYS use curves - never straight lines
    await this.curvedMoveTo(action.x, action.y, {
      curve: action.curve,
      jitter: action.jitter,
      overshoot: action.overshoot
    });
    
    // Human-like click delay
    await new Promise(resolve => setTimeout(resolve, 50 + Math.random() * 100));
    await this.sendCommand('CLICK');
    
    return { 
      clicked: true, 
      coordinates: { x: action.x, y: action.y },
      humanization: { curve: action.curve, jitter: action.jitter }
    };
  }
  
  async curvedMoveTo(targetX, targetY, options = {}) {
    const start = { ...this.currentPosition };
    const target = { x: targetX, y: targetY };
    
    const distance = Math.sqrt(
      Math.pow(target.x - start.x, 2) + Math.pow(target.y - start.y, 2)
    );
    
    // Ensure minimum curve even for short distances
    const steps = Math.max(8, Math.floor(distance / 18));
    const curveHeight = Math.max(options.curve || 20, 12); // Minimum 12px curve
    
    // Random curve direction and characteristics
    const curveDirection = Math.random() > 0.5 ? 1 : -1;
    const curveVariation = 0.8 + Math.random() * 0.4; // 80-120% of base curve
    
    const points = [];
    for (let i = 0; i <= steps; i++) {
      const progress = i / steps;
      
      // Smooth ease with human imperfection
      const baseEase = 0.5 * (1 - Math.cos(progress * Math.PI));
      const easeVariation = (Math.random() - 0.5) * 0.03; // ±1.5% variation
      const easeProgress = Math.max(0, Math.min(1, baseEase + easeVariation));
      
      // Base linear movement
      const baseX = start.x + (target.x - start.x) * easeProgress;
      const baseY = start.y + (target.y - start.y) * easeProgress;
      
      // Apply curve perpendicular to movement direction
      const angle = Math.atan2(target.y - start.y, target.x - start.x);
      const perpAngle = angle + Math.PI / 2;
      
      // Natural curve that peaks in middle, varies in intensity
      let curveOffset = 0;
      if (progress > 0.1 && progress < 0.9) {
        const curveProgress = (progress - 0.1) / 0.8;
        curveOffset = Math.sin(curveProgress * Math.PI) * curveHeight * curveDirection * curveVariation;
      }
      
      // Add overshoot near the end (if enabled)
      let overshoot = 0;
      if (options.overshoot && progress > 0.85) {
        const overshootProgress = (progress - 0.85) / 0.15;
        overshoot = Math.sin(overshootProgress * Math.PI * 2) * 3;
      }
      
      // Human tremor/jitter
      const jitter = options.jitter || 0.8;
      const jitterX = (Math.random() - 0.5) * jitter;
      const jitterY = (Math.random() - 0.5) * jitter;
      
      const finalX = baseX + Math.cos(perpAngle) * (curveOffset + overshoot) + jitterX;
      const finalY = baseY + Math.sin(perpAngle) * (curveOffset + overshoot) + jitterY;
      
      points.push({ x: finalX, y: finalY });
    }
    
    // Execute curved movement
    let currentPos = { ...start };
    for (const point of points.slice(1)) {
      if (this.emergencyStop) break;
      
      const deltaX = point.x - currentPos.x;
      const deltaY = point.y - currentPos.y;
      
      if (Math.abs(deltaX) > 0.8 || Math.abs(deltaY) > 0.8) {
        await this.sendCommand(`MOVE,${Math.round(deltaX)},${Math.round(deltaY)}`);
        currentPos.x += deltaX;
        currentPos.y += deltaY;
        
        // Variable speed - slower at start/end, faster in middle
        const progress = points.indexOf(point) / points.length;
        let delay;
        if (progress < 0.15 || progress > 0.85) {
          delay = 18 + Math.random() * 8; // 18-26ms at ends
        } else {
          delay = 12 + Math.random() * 6; // 12-18ms in middle
        }
        
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    
    this.currentPosition = { x: targetX, y: targetY };
  }
  
  async humanizedScroll(action) {
    const scrollDirection = action.direction === 'up' ? -1 : 1;
    
    if (action.style === 'burst') {
      // Burst scrolling - quick flicks
      console.log(`💫 Burst scrolling ${action.direction} (${action.bursts} bursts)`);
      
      for (let burst = 0; burst < action.bursts; burst++) {
        if (this.emergencyStop) break;
        
        const burstSize = 2 + Math.floor(Math.random() * 4); // 2-5 scrolls per burst
        const scrollAmount = action.amount + Math.floor((Math.random() - 0.5) * 2);
        
        for (let i = 0; i < burstSize; i++) {
          await this.sendCommand(`SCROLL,${scrollAmount * scrollDirection}`);
          await new Promise(resolve => setTimeout(resolve, 15 + Math.random() * 10));
        }
        
        // Pause between bursts
        if (burst < action.bursts - 1) {
          await new Promise(resolve => setTimeout(resolve, 200 + Math.random() * 300));
        }
      }
      
      return { 
        scrolled: true, 
        style: 'burst', 
        direction: action.direction, 
        bursts: action.bursts 
      };
      
    } else {
      // Smooth scrolling with variable speed
      console.log(`📜 Smooth scrolling ${action.direction} for ${action.duration}ms`);
      
      const totalScrolls = Math.floor(action.duration / 100);
      
      for (let i = 0; i < totalScrolls; i++) {
        if (this.emergencyStop) break;
        
        const progress = i / totalScrolls;
        let scrollAmount = action.amount;
        
        // Variable speed curve - slow start, fast middle, slow end
        if (progress < 0.2) {
          scrollAmount = Math.ceil(action.amount * (0.3 + progress * 0.7));
        } else if (progress > 0.8) {
          scrollAmount = Math.ceil(action.amount * (1.3 - progress * 0.7));
        } else {
          // Add randomness in middle section
          scrollAmount = action.amount + Math.floor((Math.random() - 0.5) * 2);
        }
        
        await this.sendCommand(`SCROLL,${scrollAmount * scrollDirection}`);
        
        // Variable timing
        const delay = 90 + Math.random() * 40; // 90-130ms
        await new Promise(resolve => setTimeout(resolve, delay));
      }
      
      return { 
        scrolled: true, 
        style: 'smooth', 
        direction: action.direction, 
        duration: action.duration 
      };
    }
  }
  
  async humanizedType(action) {
    const text = action.text || '';
    const typingSpeed = action.typingSpeed || 100; // Default 100ms per character
    
    console.log(`⌨️  Typing: "${text}"`);
    
    for (let i = 0; i < text.length; i++) {
      if (this.emergencyStop) break;
      
      const char = text[i];
      
      // Send individual character to Pico
      await this.sendCommand(`TYPE,${char}`);
      
      // Human-like typing variation
      const charDelay = typingSpeed + (Math.random() - 0.5) * 30; // ±15ms variation
      const finalDelay = Math.max(50, charDelay); // Minimum 50ms
      
      await new Promise(resolve => setTimeout(resolve, finalDelay));
    }
    
    return { 
      typed: true, 
      text: text, 
      characters: text.length,
      avgSpeed: typingSpeed 
    };
  }
  
  async humanDelay(duration) {
    // Add slight variation to delays (±10%)
    const variation = duration * 0.1 * (Math.random() - 0.5);
    const finalDelay = Math.max(100, duration + variation);
    
    console.log(`⏱️  Human thinking delay: ${Math.round(finalDelay)}ms`);
    await new Promise(resolve => setTimeout(resolve, finalDelay));
    
    return { delayed: true, duration: Math.round(finalDelay) };
  }
}

// Start the service
const service = new EnhancedGhostCursorService();
service.start();