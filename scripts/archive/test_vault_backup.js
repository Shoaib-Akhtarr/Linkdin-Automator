const vaultManager = require('../engine/vaultManager');
const path = require('path');
const fs = require('fs');

async function testVaultBackup() {
  console.log('Testing Vault Offline Encrypted Backup & Restore...');
  
  // 1. Save dummy test credential
  const testTenant = 'https://test-workday.wd5.myworkdayjobs.com/test';
  vaultManager.savePendingCredentials(testTenant, {
    email: 'testcandidate@gmail.com',
    password: 'P@ssword123456!Secure',
    totpSecret: 'JBSWY3DPEHPK3PXP'
  });
  vaultManager.commitCredentials(testTenant);
  console.log('✓ Committed test credential to active vault.');

  // 2. Export offline encrypted backup
  const backupFile = path.join(__dirname, 'test_vault_backup.enc');
  const exportPassphrase = 'MyMasterOfflinePassphrase2026!';
  vaultManager.exportOfflineBackup(exportPassphrase, backupFile);
  console.log(`✓ Exported encrypted backup to: ${backupFile}`);

  // 3. Verify backup file is encrypted and does not contain raw passwords
  const rawEnc = fs.readFileSync(backupFile, 'utf8');
  if (rawEnc.includes('P@ssword123456') || rawEnc.includes('JBSWY3DPEHPK3PXP')) {
    throw new Error('FAILED: Backup file contains plain text secrets!');
  }
  console.log('✓ Verified backup is properly encrypted (zero plaintext leak).');

  // 4. Test import/restoration
  const res = vaultManager.importOfflineBackup(exportPassphrase, backupFile);
  console.log(`✓ Restored backup successfully: ${res.restoredCount} entries restored.`);

  // 5. Verify restored credentials decrypt correctly
  const restoredCreds = vaultManager.getCredentials(testTenant);
  if (restoredCreds.password !== 'P@ssword123456!Secure' || restoredCreds.totpSecret !== 'JBSWY3DPEHPK3PXP') {
    throw new Error('FAILED: Restored credentials do not match original!');
  }
  console.log('✓ Restored credentials decrypted and verified 100% authentic!');

  // Cleanup
  fs.unlinkSync(backupFile);
  vaultManager.purgePendingCredentials(testTenant);
  const rawVault = vaultManager.loadRawVault();
  delete rawVault[vaultManager.getTenantKey(testTenant)];
  vaultManager.saveRawVault(rawVault);
  console.log('✓ Cleaned up test backup file and vault state.');
}

testVaultBackup().catch(err => {
  console.error('Vault backup test error:', err);
  process.exit(1);
});
