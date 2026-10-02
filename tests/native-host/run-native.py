"""Run only the generated, offline host on an already booted Android emulator."""
import os, subprocess, time
from pathlib import Path

fixture = Path(__file__).resolve().parent
adb = str(Path(os.environ['ANDROID_HOME']) / 'platform-tools/adb')
serial = os.environ.get('ANDROID_SERIAL')
prefix = [adb] + (['-s', serial] if serial else [])
package = 'com.mgm.offline.safetyhost'
def run(*args):
    return subprocess.run(prefix + list(args), capture_output=True, text=True, check=True).stdout.strip()

def main():
    print(run('install', '-r', str(fixture / 'android/app/build/outputs/apk/debug/app-debug.apk')))
    run('shell', 'am', 'force-stop', package)
    print(run('shell', 'am', 'start', '-n', package+'/.MainActivity'))
    pid = ''
    logs = ''
    for _ in range(60):
        pid = subprocess.run(prefix + ['shell', 'pidof', package], capture_output=True, text=True).stdout.strip()
        logs = run('logcat', '-d', '--pid='+pid, '-s', 'Capacitor/Console:I') if pid else ''
        if 'MGM_NATIVE_FAIL:' in logs:
            raise RuntimeError('\n'.join(line for line in logs.splitlines() if 'MGM_NATIVE_' in line))
        if 'MGM_NATIVE_READY' in logs:
            break
        time.sleep(0.5)
    else:
        raise RuntimeError('Native host did not become ready: '+logs[-2000:])
    run('shell', 'input', 'keyevent', 'KEYCODE_HOME')
    time.sleep(1.5)
    run('shell', 'am', 'start', '-n', package+'/.MainActivity')
    teardown_exercised = False
    disabled_exercised = False
    for _ in range(40):
        logs = run('logcat', '-d', '--pid='+pid, '-s', 'Capacitor/Console:I')
        if 'MGM_NATIVE_FAIL:' in logs:
            raise RuntimeError('\n'.join(line for line in logs.splitlines() if 'MGM_NATIVE_' in line))
        if 'MGM_NATIVE_DESTROYED_READY' in logs and not teardown_exercised:
            teardown_exercised = True
            run('shell', 'input', 'keyevent', 'KEYCODE_HOME')
            time.sleep(1.5)
            run('shell', 'am', 'start', '-n', package+'/.MainActivity')
        if 'MGM_NATIVE_DISABLED_READY' in logs and not disabled_exercised:
            disabled_exercised = True
            run('shell', 'input', 'keyevent', 'KEYCODE_HOME')
            time.sleep(1.5)
            run('shell', 'am', 'start', '-n', package+'/.MainActivity')
        if 'MGM_NATIVE_PASS:' in logs:
            print('\n'.join(line for line in logs.splitlines() if 'MGM_NATIVE_' in line))
            break
        time.sleep(0.5)
    else:
        raise RuntimeError('Native lifecycle did not complete: '+logs[-2000:])

try:
    main()
finally:
    run('shell', 'am', 'force-stop', package)
