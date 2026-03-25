// Fixture: dynamic import() expressions (edge case #12)
export async function loadModule(name: string) {
  const mod = await import('./basic.js');
  return mod.greet(name);
}
