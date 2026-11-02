/**
 * Export Encrypted Portable Vault Backup
 * Usage: node scripts/export_vault_backup.js [optional_passphrase] [optional_output_path]
 */
const vaultManager = require('../engine/vaultManager');
const path = require('path');

const passphrase = process.argv[2] || process.env.VAULT_PASSPHRASE || 'DefaultSafeLinkdinVaultRecoveryPassphrase2026!';
const defaultOutput = path.join(process.cwd(), 'data', 'vault_portable_recovery.enc');
const outputPath = process.argv[3] || defaultOutput;

try {
  const file = vaultManager.exportOfflineBackup(passphrase, outputPath);
  console.log('====================================================');
  console.log('🔐 VAULT PORTABLE BACKUP EXPORTED SUCCESSFULLY');
  console.log('====================================================');
  console.log(`Backup File: ${file}`);
  console.log('Encryption:  AES-256-GCM (100,000 PBKDF2 iterations)');
  console.log('Security:    Protected with your passphrase. Safe to store offline or on a USB drive.');
  console.log('\nTo restore this backup on another computer or after Windows reinstall:');
  console.log(`node scripts/import_vault_backup.js "${passphrase}" "${file}"`);
  console.log('====================================================');
} catch (err) {
  console.error('❌ Failed to export vault backup:', err.message);
  process.exit(1);
}
