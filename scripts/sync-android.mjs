import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const result = spawnSync(process.execPath, [require.resolve('@capacitor/cli/bin/capacitor'), 'sync', 'android'], {
  env: { ...process.env, BEECH_CAP_ANDROID: '1' },
  stdio: 'inherit',
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
