const { execFileSync } = require('child_process');
const crypto = require('crypto');

function protectWithDpapi(dataBuffer) {
  const b64Input = dataBuffer.toString('base64');
  const psScript = `
    Add-Type -AssemblyName System.Security
    $raw = [Convert]::FromBase64String('${b64Input}')
    $enc = [System.Security.Cryptography.ProtectedData]::Protect($raw, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
    [Convert]::ToBase64String($enc)
  `;
  const stdout = execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psScript], { encoding: 'utf8' });
  return Buffer.from(stdout.trim().split('\r\n').pop().trim(), 'base64');
}

function unprotectWithDpapi(encryptedBuffer) {
  const b64Input = encryptedBuffer.toString('base64');
  const psScript = `
    Add-Type -AssemblyName System.Security
    $raw = [Convert]::FromBase64String('${b64Input}')
    $dec = [System.Security.Cryptography.ProtectedData]::Unprotect($raw, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
    [Convert]::ToBase64String($dec)
  `;
  const stdout = execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psScript], { encoding: 'utf8' });
  return Buffer.from(stdout.trim().split('\r\n').pop().trim(), 'base64');
}

try {
  const testData = crypto.randomBytes(32);
  console.log('Original key hex:', testData.toString('hex'));
  const enc = protectWithDpapi(testData);
  console.log('Encrypted with DPAPI, length:', enc.length);
  const dec = unprotectWithDpapi(enc);
  console.log('Decrypted key matches:', testData.equals(dec));
} catch (err) {
  console.error('DPAPI test failed:', err.message);
}
