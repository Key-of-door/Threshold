// Exercise real CLI prompts with deterministic pipe input; not a physical PTY test.
Object.defineProperty(process.stdin, 'isTTY', { value: true });
Object.defineProperty(process.stdout, 'isTTY', { value: true });
