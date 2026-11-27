// Fails fast, with a fix, when npm scripts run on a Node the toolchain can't use.
// Runs automatically before dev / build / test / e2e (see "pre*" scripts in package.json).
import os from 'node:os';

const [major, minor] = process.versions.node.split('.').map(Number);
const problems = [];

// Vite 8 / Vitest / Playwright need ^20.19 || >=22.12 (see frontend/.nvmrc).
if (!((major === 20 && minor >= 19) || (major === 22 && minor >= 12) || major >= 23)) {
  problems.push(`Node ${process.version} is not supported (need 20.19+ or 22.12+).`);
}

// An Intel (x64) Node on an Apple Silicon Mac runs under Rosetta and looks for x64
// native binaries (TypeScript 7, rolldown, ...), but npm installed arm64 ones.
const appleSilicon = process.platform === 'darwin' && os.cpus()[0]?.model?.startsWith('Apple');
if (appleSilicon && process.arch === 'x64') {
  problems.push(`Node ${process.version} at ${process.execPath} is an Intel (x64) build running under Rosetta on Apple Silicon.`);
}

if (problems.length) {
  console.error(
    ['', '✖ Wrong Node for the agent editor:', ...problems.map((p) => `  - ${p}`), '',
     '  Fix:  nvm use            (in frontend/, picks Node 22 from .nvmrc)',
     '        nvm alias default 22   (to make it stick for new shells)', ''].join('\n'),
  );
  process.exit(1);
}
