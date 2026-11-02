/**
 * Import and Restore Encrypted Portable Vault Backup
 * Usage: node scripts/import_vault_backup.js <passphrase> [input_path]
 */
const vaultManager = require('../engine/vaultManager');
const path = require('path');

const passphrase = process.argv[2] || process.env.VAULT_PASSPHRASE;
if (!passphrase) {
  console.error('Usage: node scripts/import_vault_backup.js <passphrase> [path_to_backup.enc]');
  process.exit(1);
}

const defaultInput = path.join(process.cwd(), 'data', 'vault_portable_recovery.enc');
const inputPath = process.argv[3] || defaultInput;

try {
  const result = vaultManager.importOfflineBackup(passphrase, inputPath);
  console.log('====================================================');
  console.log('🔓 VAULT RESTORED SUCCESSFULLY');
  console.log('====================================================');
  console.log(`Source File:       ${inputPath}`);
  console.log(`Restored Entries:  ${result.restoredCount}`);
  console.log(`Total In Vault:    ${result.totalEntries}`);
  console.log('All credentials, passwords, and TOTP seeds are now securely active in your local vault.');
  console.log('====================================================');
} catch (err) {
  console.error('❌ Failed to restore vault backup:', err.message);
  process.exit(1);
}
