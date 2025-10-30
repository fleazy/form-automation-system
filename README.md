# Form Automation System

An advanced form automation system using Pi Pico, Chrome extension, and n8n workflows.

## Components

### 1. Chrome Extension (`extension/`)
- Detects form fields on web pages
- Calculates absolute coordinates with browser chrome offsets
- Sends form data to local automation server

### 2. Reading Behavior Script (`reading-behavior.js`)
- Controls Pi Pico via serial connection
- Handles automation commands from n8n
- Simulates natural reading behavior
- **Fixed**: DELAY commands now handled locally, no longer blocks command queue

### 3. n8n Workflow (`form-automation-workflow.json`)
- Processes form field data
- Uses AI to generate realistic form values
- Converts to Pi Pico commands

### 4. Enhanced Ghost Cursor (`enhanced.js`)
- Alternative Pi Pico controller with advanced humanization
- Curved mouse movements with human-like imperfections
- Variable typing speeds and natural delays

## Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Load Chrome extension:**
   - Go to `chrome://extensions/`
   - Enable Developer mode
   - Load unpacked extension from `extension/` folder

3. **Start automation server:**
   ```bash
   node reading-behavior.js
   ```

4. **Import n8n workflow:**
   - Import `form-automation-workflow.json` into n8n
   - Configure Anthropic API credentials

## Usage

1. Load a web page with forms
2. Extension automatically detects form fields
3. n8n workflow generates automation commands
4. Pi Pico executes physical mouse/keyboard actions

## Features

- **Human-like automation**: Natural mouse movements, variable typing speeds
- **Form field detection**: Automatic identification and coordinate calculation
- **AI-powered form filling**: Claude generates realistic form data
- **Physical hardware control**: Pi Pico bypasses software-based bot detection
- **Reading behavior simulation**: Realistic browsing patterns while forms are processed

## Fixed Issues

- ✅ DELAY commands now processed locally instead of being sent to Pico
- ✅ Command queue no longer blocks on missing "OK" responses
- ✅ Proper error handling for serial port operations
- ✅ Coordination between reading sessions and automation

## Hardware Requirements

- Raspberry Pi Pico with HID firmware
- USB connection to computer
- Serial communication at 115200 baud

## Configuration

The system runs on port 3004 by default. Update the following if needed:
- Chrome extension endpoints in `content.js`
- n8n workflow HTTP request URL
- Server port in `reading-behavior.js`