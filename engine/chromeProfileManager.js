const fs = require('fs');
const path = require('path');
const { spawn, exec, execSync } = require('child_process');

class ChromeProfileManager {
  constructor() {
    this.localAppData = process.env.LOCALAPPDATA || 'C:\\Users\\Default\\AppData\\Local';
    this.chromeUserDataDir = path.join(this.localAppData, 'Google', 'Chrome', 'User Data');
    this.autoApplyDataDir = path.join(this.localAppData, 'Google', 'Chrome', 'AutoApply Data');
    this.chromePaths = [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      path.join(this.localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe')
    ];
    
    // Ensure AutoApply data directory exists
    try {
      if (!fs.existsSync(this.autoApplyDataDir)) {
        fs.mkdirSync(this.autoApplyDataDir, { recursive: true });
      }
    } catch (_) {}
  }

  getChromeExecutable() {
    for (const p of this.chromePaths) {
      if (fs.existsSync(p)) return p;
    }
    return 'chrome.exe';
  }

  /**
   * Scans existing Google Chrome installation and lists all profiles
   */
  listProfiles() {
    const profiles = [];
    const localStatePath = path.join(this.chromeUserDataDir, 'Local State');

    if (!fs.existsSync(localStatePath)) {
      // Fallback: check if Default folder exists
      if (fs.existsSync(path.join(this.chromeUserDataDir, 'Default'))) {
        profiles.push({
          id: 'Default',
          name: 'Default Profile',
          email: '',
          avatar: '',
          isDefault: true
        });
      }
      return profiles;
    }

    try {
      const localState = JSON.parse(fs.readFileSync(localStatePath, 'utf8'));
      const infoCache = localState.profile?.info_cache || {};

      for (const [dirName, info] of Object.entries(infoCache)) {
        profiles.push({
          id: dirName,
          name: info.name || dirName,
          email: info.user_name || '',
          avatar: info.avatar_icon || '',
          isDefault: dirName === 'Default'
        });
      }

      // If no info_cache, check Default
      if (profiles.length === 0 && fs.existsSync(path.join(this.chromeUserDataDir, 'Default'))) {
        profiles.push({
          id: 'Default',
          name: 'Default Profile',
          email: '',
          avatar: '',
          isDefault: true
        });
      }
    } catch (err) {
      console.error('[ChromeProfileManager] Failed to parse Local State:', err.message);
      if (fs.existsSync(path.join(this.chromeUserDataDir, 'Default'))) {
        profiles.push({
          id: 'Default',
          name: 'Default Profile',
          email: '',
          avatar: '',
          isDefault: true
        });
      }
    }

    return profiles;
  }

  /**
   * Safely clones authenticated session cookies from normal Chrome into isolated AutoApply Data
   * Skips OS lock files so Chrome can remain open without EBUSY errors.
   */
  syncCookiesFromDefaultChrome(profileDir = 'Default') {
    try {
      const srcDir = path.join(this.chromeUserDataDir, profileDir);
      const destDir = path.join(this.autoApplyDataDir, profileDir);
      if (!fs.existsSync(srcDir)) return;
      if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

      const itemsToCopy = ['Cookies', 'Login Data', 'Web Data', 'Network'];
      for (const item of itemsToCopy) {
        const sPath = path.join(srcDir, item);
        const dPath = path.join(destDir, item);
        if (fs.existsSync(sPath)) {
          try {
            if (fs.statSync(sPath).isDirectory()) {
              if (!fs.existsSync(dPath)) fs.mkdirSync(dPath, { recursive: true });
              const subFiles = fs.readdirSync(sPath);
              for (const sf of subFiles) {
                if (sf.toLowerCase().includes('lock') || sf.toLowerCase().includes('singleton')) continue;
                try {
                  fs.copyFileSync(path.join(sPath, sf), path.join(dPath, sf));
                } catch (_) {}
              }
            } else {
              fs.copyFileSync(sPath, dPath);
            }
          } catch (_) {}
        }
      }
    } catch (_) {}
  }

  /**
   * Opens Google Chrome directly for user login on a target platform using isolated AutoApply Data
   * @param {string} profileDir e.g. "Default" or "Profile 1"
   * @param {string} url target login URL
   */
  openChromeForLogin(profileDir = 'Default', url = 'https://www.linkedin.com/login') {
    this.syncCookiesFromDefaultChrome(profileDir);
    const chromeExe = this.getChromeExecutable();
    const cmd = `start "" "${chromeExe}" --user-data-dir="${this.autoApplyDataDir}" --profile-directory="${profileDir}" "${url}"`;
    try {
      exec(cmd, (err) => {
        if (err) {
          exec(`start "" "${url}"`);
        }
      });
      return true;
    } catch (err) {
      try {
        exec(`start "" "${url}"`);
      } catch (_) {}
      return false;
    }
  }

  /**
   * Launch Chrome with debugging port 9222 enabled
   */
  async launchChromeDebug(profileDir = 'Default', isHeadless = false, killExisting = false) {
    if (killExisting) {
      try {
        execSync('taskkill /F /IM chrome.exe', { stdio: 'ignore' });
        await new Promise(r => setTimeout(r, 1000));
      } catch (_) {}
    }

    const chromeExe = this.getChromeExecutable();
    const args = [
      '--remote-debugging-port=9222',
      `--user-data-dir=${this.autoApplyDataDir}`,
      `--profile-directory=${profileDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-blink-features=AutomationControlled',
      'https://www.linkedin.com/feed/'
    ];

    if (isHeadless) {
      args.unshift('--headless=new');
      const proc = spawn(chromeExe, args, {
        detached: true,
        stdio: 'ignore',
        windowsHide: true
      });
      proc.unref();
    } else if (process.platform === 'win32') {
      const { exec } = require('child_process');
      const startCmd = `start "" "${chromeExe}" ${args.join(' ')}`;
      exec(startCmd, { shell: 'cmd.exe' });
    } else {
      const proc = spawn(chromeExe, args, {
        detached: true,
        stdio: 'ignore',
        windowsHide: false
      });
      proc.unref();
    }
    return true;
  }
}

module.exports = new ChromeProfileManager();
