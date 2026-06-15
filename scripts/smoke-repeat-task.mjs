const base = process.env.MINI_DROP_BASE_URL || 'http://127.0.0.1:8787';
const repeat = Math.max(2, Number(process.env.MINI_DROP_REPEAT_COUNT || 2));

async function createTask(index) {
  const payload = {
    target: `repeat-smoke-${index}@local`,
    language: 'Python',
    collector: 'py-spy',
    scenario: 'python_hot_loop',
  };

  const response = await fetch(base + '/api/tasks', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`/api/tasks -> ${response.status}`);
  }

  const body = await response.json();
  console.log(body.task?.id || `created-${index}`);
}

async function main() {
  for (let index = 0; index < repeat; index += 1) {
    await createTask(index);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
