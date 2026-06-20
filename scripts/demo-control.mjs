import { execFileSync, spawnSync } from 'node:child_process';

const hostPort = process.env.MINI_DROP_HOST_PORT || '8787';
const waitRetries = Number(process.env.MINI_DROP_WAIT_RETRIES || 60);
const waitIntervalMs = Number(process.env.MINI_DROP_WAIT_INTERVAL_MS || 2000);
const demoTarget = process.env.DEMO_TARGET || 'mini-drop-demo-target';

function composeArgs(...extraArgs) {
  return ['compose', '-f', 'docker-compose.yml', '-f', 'docker-compose.ebpf-demo.yml', ...extraArgs];
}

function runDocker(extraArgs, options = {}) {
  const result = spawnSync('docker', composeArgs(...extraArgs), {
    stdio: options.capture ? ['inherit', 'pipe', 'pipe'] : 'inherit',
    encoding: 'utf8',
    cwd: process.cwd(),
    env: process.env,
  });

  if (result.status !== 0) {
    const stderr = (result.stderr || '').trim();
    const stdout = (result.stdout || '').trim();
    const detail = stderr || stdout || `docker compose exited with code ${result.status}`;
    throw new Error(detail);
  }

  return options.capture ? String(result.stdout || '').trim() : '';
}

async function waitFor(url, label) {
  for (let attempt = 1; attempt <= waitRetries; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {}

    if (attempt === waitRetries) {
      throw new Error(`${label} did not become healthy`);
    }

    await new Promise((resolve) => setTimeout(resolve, waitIntervalMs));
  }
}

async function waitForDemo() {
  await waitFor(`http://127.0.0.1:${hostPort}/api/health`, 'Mini-Drop');
  await waitFor('http://127.0.0.1:18080/health', 'demo target');
}

function printDemoPid() {
  const containerId = runDocker(['ps', '-q', demoTarget], { capture: true });
  if (!containerId) {
    throw new Error('demo target container is not running');
  }

  const pid = execFileSync('docker', ['inspect', '-f', '{{.State.Pid}}', containerId], {
    encoding: 'utf8',
    cwd: process.cwd(),
    env: process.env,
  }).trim();

  console.log('');
  console.log(`Mini-Drop UI: http://127.0.0.1:${hostPort}/`);
  console.log('Demo target: http://127.0.0.1:18080/health');
  console.log(`Use this PID in Mini-Drop: ${pid}`);
  console.log('Recommended task: targetType=pid/process, language=Go, collector=eBPF, scenario=cpu_hot');
  console.log('');
  console.log('Generate service load: make demo-load');
  console.log('Generate raw IO jitter: make demo-io');
  console.log('Generate scheduler jitter: make demo-sched');
  console.log('');
}

function startLoad() {
  try {
    runDocker(['--profile', 'loadgen', 'rm', '-f', '-s', 'demo-loadgen']);
  } catch {}

  runDocker(['--profile', 'loadgen', 'up', '-d', '--force-recreate', 'demo-loadgen']);
  console.log("demo-loadgen started in background. Use 'make demo-load-stop' to stop it.");
}

function stopLoad() {
  runDocker(['--profile', 'loadgen', 'stop', 'demo-loadgen']);
}

async function main() {
  const action = process.argv[2];

  switch (action) {
    case 'wait':
      await waitForDemo();
      return;
    case 'pid':
      printDemoPid();
      return;
    case 'load':
      startLoad();
      return;
    case 'load-stop':
      stopLoad();
      return;
    default:
      throw new Error(`Unknown demo-control action: ${action || 'missing'}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
