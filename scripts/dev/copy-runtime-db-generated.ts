import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function resolveRepoRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '../..');
}

function shouldCopySharedArtifact(sourcePath: string): boolean {
  if (statSync(sourcePath).isDirectory()) return true;
  const filename = basename(sourcePath);
  return filename.endsWith('.js') || filename.endsWith('.d.ts');
}

function copyDirectoryRecursive(
  sourcePath: string,
  targetPath: string,
  filter: (sourcePath: string) => boolean = () => true,
): void {
  if (!filter(sourcePath)) return;

  const stat = statSync(sourcePath);
  if (!stat.isDirectory()) {
    mkdirSync(dirname(targetPath), { recursive: true });
    copyFileSync(sourcePath, targetPath);
    return;
  }

  mkdirSync(targetPath, { recursive: true });
  for (const entry of readdirSync(sourcePath)) {
    copyDirectoryRecursive(
      resolve(sourcePath, entry),
      resolve(targetPath, entry),
      filter,
    );
  }
}

export function copyRuntimeDbGeneratedAssets(repoRoot: string = resolveRepoRoot()): void {
  const sourceDir = resolve(repoRoot, 'src/server/db/generated');
  const targetDir = resolve(repoRoot, 'dist/server/db/generated');
  const sharedSourceDir = resolve(repoRoot, 'src/shared');
  const sharedTargetDir = resolve(repoRoot, 'dist/shared');

  if (!existsSync(sourceDir)) {
    throw new Error(`Runtime DB generated assets directory does not exist: ${sourceDir}`);
  }

  mkdirSync(dirname(targetDir), { recursive: true });
  copyDirectoryRecursive(sourceDir, targetDir);

  if (existsSync(sharedSourceDir)) {
    rmSync(sharedTargetDir, { recursive: true, force: true });
    mkdirSync(dirname(sharedTargetDir), { recursive: true });
    copyDirectoryRecursive(sharedSourceDir, sharedTargetDir, shouldCopySharedArtifact);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  copyRuntimeDbGeneratedAssets();
}
