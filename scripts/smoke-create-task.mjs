const base = process.env.MINI_DROP_BASE_URL || 'http://127.0.0.1:8787';
const payload = {
  target: 'smoke@local',
  language: 'Python',
  collector: 'py-spy',
  scenario: 'python_hot_loop',
};

async function main() {
  const response = await fetch(base + '/api/tasks', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`/api/tasks -> ${response.status}`);
  }

  const body = await response.json();
  console.log(body.task?.id || 'created');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
