const base = process.env.MINI_DROP_BASE_URL || 'http://127.0.0.1:8787';
const paths = ['/api/health', '/api/tasks', '/api/processes'];

async function main() {
  for (const path of paths) {
    const response = await fetch(base + path);
    if (!response.ok) {
      throw new Error(`${path} -> ${response.status}`);
    }
    console.log(`${path} ok`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
