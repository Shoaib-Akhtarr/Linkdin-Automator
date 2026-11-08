const fs = require('fs');
const path = require('path');

const orchPath = path.join(__dirname, '..', 'engine', 'orchestrator.js');
let code = fs.readFileSync(orchPath, 'utf8');

const streamMethods = `
  startLiveScreenStream() {
    if (this._screencastInterval) return;
    this._screencastInterval = setInterval(async () => {
      if (this.state !== 'running' && this.state !== 'awaiting_review') return;
      try {
        if (browserBridge.page && !browserBridge.page.isClosed()) {
          const ss = await browserBridge.takeScreenshot();
          if (ss) {
            this.emit('screenshot', ss);
          }
        }
      } catch (_) {}
    }, 1200);
  }

  stopLiveScreenStream() {
    if (this._screencastInterval) {
      clearInterval(this._screencastInterval);
      this._screencastInterval = null;
    }
  }
`;

if (!code.includes('startLiveScreenStream')) {
  // Add streamMethods right before start()
  code = code.replace(/async start\(\) \{/, `${streamMethods}\r\n  async start() {\r\n    this.startLiveScreenStream();`);
  
  // Add stopLiveScreenStream() in stop()
  code = code.replace(/async stop\(\) \{/, `async stop() {\r\n    this.stopLiveScreenStream();`);

  // Emit initial screenshot after connect in runLoop()
  code = code.replace(
    /let page = await browserBridge\.connect\(\);/,
    `let page = await browserBridge.connect();\r\n      try {\r\n        const initialSs = await browserBridge.takeScreenshot();\r\n        if (initialSs) this.emit('screenshot', initialSs);\r\n      } catch (_) {}`
  );

  fs.writeFileSync(orchPath, code, 'utf8');
  console.log('✅ Added continuous live screencast streaming to orchestrator.js');
} else {
  console.log('startLiveScreenStream already present in orchestrator.js');
}
