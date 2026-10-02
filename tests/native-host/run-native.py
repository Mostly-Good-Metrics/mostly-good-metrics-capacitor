"""Run only the generated, offline host on an already booted Android emulator."""
import os, subprocess, time
from pathlib import Path

fixture = Path(__file__).resolve().parent
adb = str(Path(os.environ['ANDROID_HOME']) / 'platform-tools/adb')
serial = os.environ.get('ANDROID_SERIAL')
prefix = [adb] + (['-s', serial] if serial else [])
package = 'com.mgm.offline.safetyhost'
def run(*args):
    return subprocess.run(prefix + list(args), capture_output=True, text=True, check=True, timeout=15).stdout.strip()

def read_logs(pid, started):
    current = run('shell', 'pidof', package)
    if current != pid:
        raise RuntimeError('Native host died or restarted: expected '+pid+', got '+current)
    logs = run('logcat', '-d', '--pid='+pid, '-T', started, '-s', 'Capacitor/Console:I', 'AndroidRuntime:E', 'libc:F')
    if 'FATAL EXCEPTION' in logs or 'Fatal signal' in logs:
        raise RuntimeError('Native host crashed: '+logs[-4000:])
    return logs

def cycle_lifecycle(pid, started, phase):
    run('shell', 'input', 'keyevent', 'KEYCODE_HOME')
    for _ in range(60):
        logs = read_logs(pid, started)
        if 'MGM_NATIVE_FAIL:' in logs:
            raise RuntimeError(logs[-4000:])
        if 'MGM_NATIVE_STATE:'+phase+':false' in logs:
            run('shell', 'am', 'start', '-n', package+'/.MainActivity')
            return
        time.sleep(0.5)
    raise RuntimeError('Native background transition missing: '+run('shell', 'dumpsys', 'window')[-4000:]+'\n'+logs[-4000:])

def main():
    print(run('install', '-r', str(fixture / 'android/app/build/outputs/apk/debug/app-debug.apk')))
    run('shell', 'am', 'force-stop', package)
    run('shell', 'input', 'keyevent', 'KEYCODE_WAKEUP')
    run('shell', 'wm', 'dismiss-keyguard')
    started = run('shell', 'date', '+%s.%N')
    print(run('shell', 'am', 'start', '-n', package+'/.MainActivity'))
    pid = ''
    for _ in range(60):
        pid = subprocess.run(prefix + ['shell', 'pidof', package], capture_output=True, text=True, timeout=15).stdout.strip()
        if pid:
            break
        time.sleep(0.5)
    if not pid.isdigit():
        raise RuntimeError('Native host did not start with one process: '+pid)
    logs = ''
    for _ in range(60):
        logs = read_logs(pid, started)
        if 'MGM_NATIVE_FAIL:' in logs:
            raise RuntimeError('\n'.join(line for line in logs.splitlines() if 'MGM_NATIVE_' in line))
        if 'MGM_NATIVE_READY' in logs:
            break
        time.sleep(0.5)
    else:
        raise RuntimeError('Native host did not become ready: '+logs[-2000:])
    cycle_lifecycle(pid, started, 'active')
    teardown_exercised = False
    disabled_exercised = False
    for _ in range(40):
        logs = read_logs(pid, started)
        if 'MGM_NATIVE_FAIL:' in logs:
            raise RuntimeError('\n'.join(line for line in logs.splitlines() if 'MGM_NATIVE_' in line))
        if 'MGM_NATIVE_DESTROYED_READY' in logs and not teardown_exercised:
            teardown_exercised = True
            cycle_lifecycle(pid, started, 'destroyed')
        if 'MGM_NATIVE_DISABLED_READY' in logs and not disabled_exercised:
            disabled_exercised = True
            cycle_lifecycle(pid, started, 'disabled')
        if 'MGM_NATIVE_PASS:' in logs:
            time.sleep(0.5)
            logs = read_logs(pid, started)
            if 'MGM_NATIVE_FAIL:' in logs:
                raise RuntimeError(logs[-4000:])
            print('\n'.join(line for line in logs.splitlines() if 'MGM_NATIVE_' in line))
            break
        time.sleep(0.5)
    else:
        raise RuntimeError('Native lifecycle did not complete: '+logs[-2000:])

try:
    main()
finally:
    run('shell', 'am', 'force-stop', package)
